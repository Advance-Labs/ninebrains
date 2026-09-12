/**
 * Ninebrains (T36): hardening for every git call the app makes. A lane can edit its repo's
 * `.git/config` and `info/attributes`, those are shared with every worktree of the repo, including
 * the user's main checkout, and upstream runs git against those worktrees outside any sandbox:
 * `status` on every watch event, the registry scan's `status` and `diff`. So repo config must not
 * be able to run programs through the app's git calls.
 *
 * Every call gets these as `GIT_CONFIG_COUNT` entries, which rank above repo config:
 * - `core.fsmonitor=false`;
 * - `core.hooksPath=/dev/null`, except on user-initiated writes (commit, push or pull from the
 *   UI), which keep the user's hooks.
 * It also gets a default `GIT_SSH_COMMAND`, which git prefers over a repo's `core.sshCommand`.
 *
 * Read-only calls also get:
 * - `GIT_NO_LAZY_FETCH=1`: a missing object in a partial clone is an error, never a fetch
 *   through the repo's promisor remote (T32). In a user's own partial clone, a diff or blame that
 *   needs a blob that was never fetched fails instead;
 * - `--no-ext-diff --no-textconv` on `diff`, `log` and `show` (`blame`: `--no-textconv`);
 * - the repo's own filter drivers (local and worktree scope) blanked on the reads that run them:
 *   `status`, `diff`, `blame`, `ls-files` and `cat-file --filters`. Global and system drivers,
 *   such as a normal git-lfs install, keep working. With a repo-local LFS install, files show
 *   as modified.
 *
 * Not done, on purpose:
 * - `diff.external` is not set: an empty value makes git run an empty command, so `git diff`
 *   fails.
 * - Writes keep their filters: blanking a clean filter on `add` would commit raw content where
 *   LFS expects a pointer.
 * The driver listing and the call are two processes, so a live lane can race a new driver in
 * between them. The lane sandbox's write deny on the repo config (SEC-11) closes that.
 */
import { ExecError, type BoundExec, type ExecOptions } from './types';

export type GitCallKind = 'read' | 'app-write' | 'user-write';
type WriteKind = Exclude<GitCallKind, 'read'>;

/** Subcommands that only read the repository (config and remote writes run no hooks). */
const READ_ONLY = new Set([
  'blame',
  'cat-file',
  'check-attr',
  'check-ignore',
  'config',
  'count-objects',
  'describe',
  'diff',
  'diff-files',
  'diff-index',
  'diff-tree',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'name-rev',
  'remote',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'show-ref',
  'status',
  'symbolic-ref',
  'var',
  'version',
]);
/** Reads that run filter drivers on working-tree files. */
const FILTERING = new Set(['status', 'diff', 'blame', 'ls-files']);
/** git's global options that take the next argument as their value. */
const VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace']);
/** A filter driver name that is safe inside `-c filter.<name>.<key>=`. */
const DRIVER = /^[A-Za-z0-9._-]{1,128}$/;

/** Index of the subcommand after git's global options, or -1. */
function subcommandIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('-')) return i;
    if (VALUE_OPTIONS.has(args[i])) i++;
  }
  return -1;
}

/** `read` for read-only subcommands, otherwise the caller's write kind. */
export function gitCallKind(args: readonly string[], write: WriteKind): GitCallKind {
  const at = subcommandIndex(args);
  const sub = at === -1 ? undefined : args[at];
  if (sub !== undefined && READ_ONLY.has(sub)) return 'read';
  if (sub === 'worktree' && args[at + 1] === 'list') return 'read';
  return write;
}

/** Appends `-c`-equivalent entries after any the caller's env already has, so ours win. */
function withGitConfig(
  base: NodeJS.ProcessEnv,
  entries: ReadonlyArray<readonly [string, string]>
): NodeJS.ProcessEnv {
  const count = Number.parseInt(base.GIT_CONFIG_COUNT ?? '', 10);
  const start = Number.isInteger(count) && count >= 0 ? count : 0;
  const env: NodeJS.ProcessEnv = { ...base };
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(start + entries.length);
  return env;
}

export function hardenedGitEnv(base: NodeJS.ProcessEnv, kind: GitCallKind): NodeJS.ProcessEnv {
  const config: Array<readonly [string, string]> = [['core.fsmonitor', 'false']];
  if (kind !== 'user-write') config.push(['core.hooksPath', '/dev/null']);
  const env = withGitConfig(base, config);
  env.GIT_SSH_COMMAND = base.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes';
  if (kind === 'read') env.GIT_NO_LAZY_FETCH = '1';
  return env;
}

/**
 * `-c` flags that blank every filter driver the repo's own config (local or worktree scope)
 * names. Fails closed on a name that can't be written as a `-c` key.
 */
export async function repoFilterDriverFlags(
  exec: BoundExec,
  globals: readonly string[],
  options: Pick<ExecOptions, 'cwd' | 'env'> = {}
): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await exec.exec(
      [...globals, 'config', '--null', '--show-scope', '--name-only', '--get-regexp', '^filter\\.'],
      options
    ));
  } catch (error) {
    if (error instanceof ExecError && error.exitCode === 1) return []; // no filter.* keys
    throw error;
  }
  const parts = stdout.split('\0');
  const names = new Set<string>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] !== 'local' && parts[i] !== 'worktree') continue;
    const key = parts[i + 1];
    names.add(key.slice('filter.'.length, key.lastIndexOf('.')));
  }
  const flags: string[] = [];
  for (const name of names) {
    if (!DRIVER.test(name)) {
      throw new Error(`Refusing a repository whose config names filter ${JSON.stringify(name)}`);
    }
    for (const key of ['clean', 'smudge', 'process']) flags.push('-c', `filter.${name}.${key}=`);
    flags.push('-c', `filter.${name}.required=false`);
  }
  return flags;
}

/**
 * Wraps a git exec so every call is hardened as the header describes. `write` says who starts the
 * exec's non-read calls: `app-write` (no hooks) or `user-write` (the user's hooks run).
 */
export function hardenGitExec(exec: BoundExec, write: WriteKind): BoundExec {
  const prepare = async <O extends Pick<ExecOptions, 'cwd' | 'env'>>(
    args: string[],
    options?: O
  ): Promise<{ args: string[]; options: O }> => {
    const source = typeof exec.env === 'function' ? await exec.env() : exec.env;
    const kind = gitCallKind(args, write);
    const env = hardenedGitEnv({ ...(source ?? process.env), ...options?.env }, kind);
    const hardened = { ...options, env } as O;
    if (kind !== 'read') return { args, options: hardened };
    const at = subcommandIndex(args);
    const [globals, sub, rest] = [args.slice(0, at), args[at], args.slice(at + 1)];
    const extra =
      sub === 'blame'
        ? ['--no-textconv']
        : sub === 'diff' || sub === 'log' || sub === 'show'
          ? ['--no-ext-diff', '--no-textconv']
          : [];
    const filters =
      FILTERING.has(sub) || (sub === 'cat-file' && rest.includes('--filters'))
        ? await repoFilterDriverFlags(exec, globals, { cwd: options?.cwd, env })
        : [];
    return { args: [...filters, ...globals, sub, ...extra, ...rest], options: hardened };
  };
  return {
    file: exec.file,
    cwd: exec.cwd,
    env: exec.env,
    async exec(args, options) {
      const call = await prepare(args, options);
      return exec.exec(call.args, call.options);
    },
    async execStreaming(args, onStdout, options) {
      const call = await prepare(args, options);
      return exec.execStreaming(call.args, onStdout, call.options);
    },
    async execBuffer(args, options) {
      const call = await prepare(args, options);
      return exec.execBuffer(call.args, call.options);
    },
    async spawn(args, options) {
      const call = await prepare(args, options);
      return exec.spawn(call.args, call.options);
    },
    withCwd: (cwd) => hardenGitExec(exec.withCwd(cwd), write),
  };
}

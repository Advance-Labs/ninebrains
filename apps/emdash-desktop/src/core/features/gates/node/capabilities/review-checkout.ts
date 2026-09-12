/**
 * `prepareReviewCheckout` (SEC-18): a disposable detached checkout for the reviewer, in an OS
 * temp dir, never the lane worktree.
 *
 * By default the checkout mirrors the lane's working state at HEAD: tracked modifications and
 * untracked (non-ignored) files are copied in, deletions applied, so the reviewer sees what the
 * worker actually produced even if it never committed. Only regular files are copied (no
 * symlinks, so nothing outside the worktree leaks in), each up to 5 MB.
 *
 * git runs in main, outside any sandbox, against a repo the lane can write (L4). So it gets:
 * - the tests gate's scrubbed env (no tokens, provider keys or `NINEBRAINS_*`) and an absolute
 *   binary found outside the worktree (SEC-16);
 * - `core.fsmonitor=`, `core.hooksPath=/dev/null` and `protocol.file.allow=never`, so no hook,
 *   fsmonitor or `file://` submodule runs;
 * - every filter driver the repo config names emptied (`smudge`, `clean`, `process`), because a
 *   checkout runs a smudge filter from `.git/config` otherwise (checked against git 2.53);
 * - a process group registered for the SEC-30 STOP.
 */
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  processGroups,
  signalGroup,
  spawnInGroup,
  type ProcessGroupRegistry,
} from '@core/features/exec-runs/api/node/process-group';
import { buildScrubbedCommandEnv } from '@core/features/exec-runs/api/node/run-env';
import { resolveExecutable } from './run-command';
import type { GateJob, PrepareReviewCheckout } from './types';

const MAX_COPY_BYTES = 5 * 1024 * 1024;
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{7,64}$/i;
/** A filter driver name we can safely put in `-c filter.<name>.<key>=`. */
const DRIVER = /^[A-Za-z0-9._-]{1,128}$/;

/** Hooks, fsmonitor and `file://` transports are repo-controlled code paths. */
const HARDENING = [
  '-c',
  'core.fsmonitor=',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'protocol.file.allow=never',
];

export interface GitOptions {
  /** Absolute git. Default: `git` on the scrubbed PATH, outside the worktree. */
  gitBinary?: string;
  /** Default: `process.env`, scrubbed. */
  parentEnv?: Readonly<Record<string, string | undefined>>;
  /** SEC-30 registry. Default: the app-wide one. */
  groups?: ProcessGroupRegistry;
}

export interface ReviewCheckoutRequest extends GitOptions {
  /** The lane worktree to snapshot. */
  worktreePath: string;
  /** Commit to check out. Defaults to the worktree's HEAD. */
  commit?: string;
  /** Copy uncommitted changes in (only when checking out HEAD). Default true. */
  mirrorWorkingTree?: boolean;
  /** Parent dir for checkouts. Default: the OS temp dir. Must not be inside the worktree. */
  root?: string;
}

export interface ReviewCheckout {
  path: string;
  commit: string;
  dispose(): Promise<void>;
}

const live = new Set<string>();

/** True when `path` is a checkout this module created and has not yet disposed. */
export async function isReviewCheckout(path: string): Promise<boolean> {
  const real = await realpath(path).catch(() => undefined);
  return real !== undefined && live.has(real);
}

const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

type Git = (cwd: string, args: string[], opts?: { cleanup?: boolean }) => Promise<string>;

/** A git runner bound to one lane repo: hardening flags, filter drivers emptied, scrubbed env. */
async function hardenedGit(source: string, options: GitOptions): Promise<Git> {
  const groups = options.groups ?? processGroups;
  const env: Record<string, string> = {
    ...buildScrubbedCommandEnv(options.parentEnv ?? process.env),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const binary =
    options.gitBinary ?? resolveExecutable('git', env.PATH ?? '', source, process.platform);
  const flags = [...HARDENING];
  const run: Git = (cwd, args, opts = {}) => {
    // Cleanup (worktree remove, prune) still runs while STOP is latched.
    if (!opts.cleanup) groups.assertOpen('a review-checkout git command');
    const child = spawnInGroup(binary, [...flags, ...args], { cwd, env, kind: 'command' });
    groups.track(child);
    return new Promise((resolvePromise, reject) => {
      const out: Buffer[] = [];
      let size = 0;
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_GIT_OUTPUT) out.push(chunk);
      });
      child.stderr?.setEncoding('utf8').on('data', (c: string) => {
        stderr = (stderr + c).slice(-4000);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        signalGroup(child, 'SIGKILL'); // reap anything git left behind
        if (code === 0 && size <= MAX_GIT_OUTPUT) resolvePromise(Buffer.concat(out).toString());
        else reject(new Error(`git ${args[0]} failed (${signal ?? code}): ${stderr.trim()}`));
      });
    });
  };

  // `git config` only reads; no filter or hook runs while listing. Exit 1 means no match; any
  // other failure is fatal, so a repo whose drivers we could not list is never checked out.
  const listed = await run(source, [
    'config',
    '--null',
    '--name-only',
    '--get-regexp',
    '^filter\\.',
  ]).catch((error: Error) => {
    if (/ failed \(1\):/.test(error.message)) return '';
    throw error;
  });
  const drivers = new Set(
    listed
      .split('\0')
      .filter(Boolean)
      .map((key) => key.slice('filter.'.length, key.lastIndexOf('.')))
  );
  for (const name of drivers) {
    if (!DRIVER.test(name)) throw new Error(`Refusing a repo with filter driver ${JSON.stringify(name)}`);
    for (const key of ['smudge', 'clean', 'process']) flags.push('-c', `filter.${name}.${key}=`);
    flags.push('-c', `filter.${name}.required=false`);
  }
  return run;
}

async function copyInto(source: string, dest: string, relPath: string): Promise<void> {
  const from = resolve(source, relPath);
  const to = resolve(dest, relPath);
  if (!isInside(from, source) || !isInside(to, dest)) return;
  const info = await lstat(from).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_COPY_BYTES) return;
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function mirror(git: Git, source: string, dest: string): Promise<void> {
  // name-status -z: "<status>\0<path>\0" pairs; --no-renames keeps it to one path each.
  const changes = (await git(source, ['diff', '--name-status', '--no-renames', '-z', 'HEAD']))
    .split('\0')
    .filter(Boolean);
  for (let i = 0; i + 1 < changes.length; i += 2) {
    const [status, relPath] = [changes[i], changes[i + 1]];
    if (status === 'D') await rm(resolve(dest, relPath), { force: true });
    else await copyInto(source, dest, relPath);
  }
  const untracked = (await git(source, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  for (const relPath of untracked) await copyInto(source, dest, relPath);
}

export interface PrepareReviewCheckoutDeps extends GitOptions {
  /**
   * Maps a job to its lane worktree. Must come from app state (the lane that owns the job),
   * never from anything in the job record a worker could write.
   */
  worktreeForJob: (job: GateJob) => string | Promise<string>;
  /** Parent dir for checkouts; also pass it to the supervisor's and runCommand's roots. */
  root?: string;
}

/** The gates-core `prepareReviewCheckout(job, { signal })` capability. */
export function createPrepareReviewCheckout(
  deps: PrepareReviewCheckoutDeps
): PrepareReviewCheckout {
  return async (job, { signal }) => {
    signal.throwIfAborted();
    const { worktreeForJob, ...rest } = deps;
    const checkout = await prepareReviewCheckout({
      ...rest,
      worktreePath: await worktreeForJob(job),
    });
    if (signal.aborted) {
      await checkout.dispose();
      signal.throwIfAborted();
    }
    return checkout;
  };
}

export async function prepareReviewCheckout(
  request: ReviewCheckoutRequest
): Promise<ReviewCheckout> {
  const source = await realpath(request.worktreePath);
  const git = await hardenedGit(source, request);
  const head = (await git(source, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  let commit = head;
  if (request.commit !== undefined) {
    if (!COMMIT.test(request.commit)) throw new Error(`Invalid review commit: ${request.commit}`);
    commit = (
      await git(source, ['rev-parse', '--verify', '--end-of-options', `${request.commit}^{commit}`])
    ).trim();
  }

  const root = await realpath(request.root ?? tmpdir());
  if (isInside(root, source)) throw new Error('Review checkouts must not live inside the worktree');
  const dir = await mkdtemp(join(root, 'nb-review-'));
  const path = join(dir, 'checkout');
  try {
    await git(source, ['worktree', 'add', '--detach', path, commit]);
    if ((request.mirrorWorkingTree ?? true) && commit === head) await mirror(git, source, path);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    await git(source, ['worktree', 'prune'], { cleanup: true }).catch(() => {});
    throw err;
  }
  const realPath = await realpath(path);
  if (isInside(realPath, source) || isInside(source, realPath)) {
    throw new Error('Refusing a review checkout that overlaps the lane worktree');
  }
  live.add(realPath);

  let disposed: Promise<void> | undefined;
  return {
    path: realPath,
    commit,
    dispose() {
      disposed ??= (async () => {
        live.delete(realPath);
        await git(source, ['worktree', 'remove', '--force', realPath], { cleanup: true }).catch(
          () => {}
        );
        await rm(dir, { recursive: true, force: true });
        await git(source, ['worktree', 'prune'], { cleanup: true }).catch(() => {});
      })();
      return disposed;
    },
  };
}

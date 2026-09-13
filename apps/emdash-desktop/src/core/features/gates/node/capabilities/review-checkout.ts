/**
 * `prepareReviewCheckout` (SEC-18): a disposable checkout for the reviewer, in an OS temp dir,
 * never the lane worktree.
 *
 * The checkout is its own repository (T33), not a linked worktree of the lane's repo. A fresh
 * `git init` gives it its own config and attributes; it reads objects from the lane repo through
 * `objects/info/alternates`, and the lane's branch, remote and tag refs are copied in, so a job's
 * `baseRef` resolves as it does in the lane. Nothing in the lane repo's config, `info/attributes`
 * or hooks applies to git in the checkout, so a lane process that outlives `complete_job` (R14)
 * cannot add a filter driver between the reviewer gate's driver listing and its diff.
 *
 * By default the checkout mirrors the lane's working state at HEAD: every tracked or untracked
 * (non-ignored) path whose content differs is written in and paths the lane deleted are removed,
 * so the reviewer sees what the worker actually produced even if it never committed. The mirror
 * follows no link (T35): a path under a symlinked directory counts as deleted, a symlink is
 * written as a file holding its target (the way git stores one; the checkout has
 * `core.symlinks=false`), and a file over 5 MB or with more than one hard link keeps its
 * committed version. A path with a `.git` component is never written.
 *
 * git runs in main, outside any sandbox. In the lane repo it only reads (`rev-parse`,
 * `for-each-ref`, `ls-files`). Every call, in either repo, gets:
 * - `--no-lazy-fetch` and `GIT_NO_LAZY_FETCH=1` (T32): a missing object is an error, never a
 *   fetch through the lane's promisor remote and its `core.sshCommand`. git older than 2.44
 *   rejects the flag, so there the checkout fails closed;
 * - the tests gate's scrubbed env (no tokens, provider keys or `NINEBRAINS_*`) and an absolute
 *   binary found outside the worktree (SEC-16);
 * - `core.fsmonitor=`, `core.hooksPath=/dev/null` and `protocol.file.allow=never`, so no hook,
 *   fsmonitor or `file://` submodule runs;
 * - every filter driver that repo's config names emptied (`smudge`, `clean`, `process`), because
 *   a checkout runs a smudge filter from config otherwise (checked against git 2.53);
 * - a process group registered for the SEC-30 STOP.
 */
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
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
/** One `for-each-ref` line. Anything else is skipped; `update-ref` re-checks the name. */
const REF_LINE = /^([0-9a-f]{40}|[0-9a-f]{64}) (refs\/(?:heads|remotes|tags)\/\S+)$/;
/** Code points HFS+ ignores in names, so `.g‌it` is `.git` on macOS. */
const IGNORABLE = /[​-‏‪-‮⁪-⁯﻿]/g;

/** Lazy fetch, hooks, fsmonitor and `file://` transports are repo-controlled code paths. */
const HARDENING = [
  '--no-lazy-fetch',
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

const split = (out: string) => out.split('\0').filter(Boolean);

/**
 * True for a relative, `/`-separated path that is safe to write under the checkout: no empty,
 * `.` or `..` segment, and no `.git` component in any spelling a filesystem folds to it.
 */
export function isSafeReviewPath(
  relPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (relPath.includes('\0')) return false;
  if (platform === 'win32' && /[\\:]/.test(relPath)) return false;
  return relPath.split('/').every((segment) => {
    if (segment === '' || segment === '.' || segment === '..') return false;
    const name = segment
      .replace(IGNORABLE, '')
      .replace(/[. ]+$/, '')
      .toLowerCase();
    return name !== '.git' && name !== 'git~1';
  });
}

type Git = (cwd: string, args: string[], stdin?: string) => Promise<string>;

/** A git runner factory: hardening plus per-repo `flags`, scrubbed env, process group, capped output. */
function gitRunner(options: GitOptions, anchor: string): (flags: readonly string[]) => Git {
  const groups = options.groups ?? processGroups;
  const env: Record<string, string> = {
    ...buildScrubbedCommandEnv(options.parentEnv ?? process.env),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
  };
  const binary =
    options.gitBinary ?? resolveExecutable('git', env.PATH ?? '', anchor, process.platform);
  return (flags) => (cwd, args, stdin) => {
    groups.assertOpen('a review-checkout git command');
    const child = spawnInGroup(binary, [...HARDENING, ...flags, ...args], {
      cwd,
      env,
      kind: 'command',
      stdin,
    });
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
}

/**
 * `-c` flags that empty every filter driver `repo`'s config names, in any scope. `git config` only
 * reads; no filter or hook runs while listing. Exit 1 means no match; any other failure is fatal,
 * so a repo whose drivers we could not list is never used.
 */
async function filterDriverFlags(git: Git, repo: string): Promise<string[]> {
  const listed = await git(repo, [
    'config',
    '--null',
    '--name-only',
    '--get-regexp',
    '^filter\\.',
  ]).catch((error: Error) => {
    if (/ failed \(1\):/.test(error.message)) return '';
    throw error;
  });
  const flags: string[] = [];
  const drivers = new Set(
    split(listed).map((key) => key.slice('filter.'.length, key.lastIndexOf('.')))
  );
  for (const name of drivers) {
    if (!DRIVER.test(name))
      throw new Error(`Refusing a repo with filter driver ${JSON.stringify(name)}`);
    for (const key of ['smudge', 'clean', 'process']) flags.push('-c', `filter.${name}.${key}=`);
    flags.push('-c', `filter.${name}.required=false`);
  }
  return flags;
}

/**
 * `relPath` under `root`, reached through real directories only. 'missing' when a parent is
 * absent, a link or a file: git sees such a path as deleted too.
 */
async function walk(root: string, relPath: string): Promise<string | 'missing'> {
  const parts = relPath.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    const info = await lstat(dir).catch(() => undefined);
    if (!info?.isDirectory()) return 'missing';
  }
  return join(dir, parts[parts.length - 1]);
}

type Entry = { data: Buffer; executable: boolean };

/** What the lane has at `relPath`: content to mirror, 'missing', or undefined to keep HEAD's. */
async function readLaneEntry(
  root: string,
  relPath: string
): Promise<Entry | 'missing' | undefined> {
  const path = await walk(root, relPath);
  if (path === 'missing') return 'missing';
  const info = await lstat(path).catch(() => undefined);
  if (!info) return 'missing';
  if (info.isSymbolicLink()) {
    return { data: await readlink(path, { encoding: 'buffer' }), executable: false };
  }
  if (!info.isFile() || info.size > MAX_COPY_BYTES || info.nlink > 1) return undefined;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    const data = await handle.readFile();
    // A parent swapped for a link between the walk and the open would hand us another file.
    const again = await walk(root, relPath);
    const now = again === 'missing' ? undefined : await lstat(again).catch(() => undefined);
    if (!opened.isFile() || opened.nlink > 1 || now?.ino !== opened.ino || now.dev !== opened.dev) {
      throw new Error(`The lane worktree changed while it was being mirrored: ${relPath}`);
    }
    if (data.length > MAX_COPY_BYTES) return undefined;
    return { data, executable: (opened.mode & 0o111) !== 0 };
  } finally {
    await handle.close();
  }
}

/** Puts `entry` at `relPath` in the checkout, replacing what is there, via real directories. */
async function writeEntry(root: string, relPath: string, entry: Entry): Promise<void> {
  const parts = relPath.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    const info = await lstat(dir).catch(() => undefined);
    if (info?.isDirectory()) continue;
    if (info) await rm(dir, { force: true });
    await mkdir(dir);
  }
  const to = join(dir, parts[parts.length - 1]);
  const current = await lstat(to).catch(() => undefined);
  if (
    current?.isFile() &&
    current.size === entry.data.length &&
    ((current.mode & 0o111) !== 0) === entry.executable &&
    (await readFile(to)).equals(entry.data)
  ) {
    return;
  }
  if (current) await rm(to, { recursive: true, force: true });
  await writeFile(to, entry.data, { flag: 'wx', mode: entry.executable ? 0o755 : 0o644 });
}

async function removeEntry(root: string, relPath: string): Promise<void> {
  const path = await walk(root, relPath);
  const info = path === 'missing' ? undefined : await lstat(path).catch(() => undefined);
  if (path !== 'missing' && info && !info.isDirectory()) await rm(path, { force: true });
}

/** Brings the checkout (at HEAD) to the lane's working state; see the header for the rules. */
async function mirror(git: Git, source: string, dest: string, laneFiles: string[]): Promise<void> {
  const committed = split(await git(dest, ['ls-files', '-z']));
  for (const relPath of new Set([...committed, ...laneFiles])) {
    if (!isSafeReviewPath(relPath)) continue;
    const entry = await readLaneEntry(source, relPath);
    if (entry === 'missing') await removeEntry(dest, relPath);
    else if (entry) await writeEntry(dest, relPath, entry);
  }
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
  const runner = gitRunner(request, source);
  const bare = runner([]);
  const laneGit = runner(await filterDriverFlags(bare, source));
  const head = (await laneGit(source, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  let commit = head;
  if (request.commit !== undefined) {
    if (!COMMIT.test(request.commit)) throw new Error(`Invalid review commit: ${request.commit}`);
    commit = (
      await laneGit(source, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${request.commit}^{commit}`,
      ])
    ).trim();
  }
  const format = (await laneGit(source, ['rev-parse', '--show-object-format'])).trim();
  if (format !== 'sha1' && format !== 'sha256') throw new Error(`Unknown object format ${format}`);
  const commonDir = (
    await laneGit(source, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim();
  const objects = await realpath(join(commonDir, 'objects'));
  const refs = (
    await laneGit(source, [
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ])
  )
    .split('\n')
    .flatMap((line) => {
      const match = REF_LINE.exec(line);
      return match ? [`create ${match[2]} ${match[1]}\n`] : [];
    });
  const mirrored = (request.mirrorWorkingTree ?? true) && commit === head;
  const laneFiles = mirrored
    ? split(await laneGit(source, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    : [];

  const root = await realpath(request.root ?? tmpdir());
  if (isInside(root, source)) throw new Error('Review checkouts must not live inside the worktree');
  const dir = await mkdtemp(join(root, 'nb-review-'));
  const path = join(dir, 'checkout');
  try {
    await bare(dir, ['init', '-q', '--template=', `--object-format=${format}`, path]);
    await mkdir(join(path, '.git', 'objects', 'info'), { recursive: true });
    await writeFile(join(path, '.git', 'objects', 'info', 'alternates'), `${objects}\n`);
    await bare(path, ['config', 'core.symlinks', 'false']);
    const git = runner(await filterDriverFlags(bare, path));
    if (refs.length > 0) await git(path, ['update-ref', '--stdin'], refs.join(''));
    // Not `checkout --detach`: from an unborn branch it only warns about a missing blob and exits
    // 0 without the file, so the reviewer would see a deletion. read-tree fails (git 2.53).
    await git(path, ['read-tree', '-u', '--reset', commit]);
    await git(path, ['update-ref', '--no-deref', 'HEAD', commit]);
    if (mirrored) await mirror(git, source, path, laneFiles);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  const realPath = await realpath(path);
  if (isInside(realPath, source) || isInside(source, realPath)) {
    await rm(dir, { recursive: true, force: true });
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
        await rm(dir, { recursive: true, force: true });
      })();
      return disposed;
    },
  };
}

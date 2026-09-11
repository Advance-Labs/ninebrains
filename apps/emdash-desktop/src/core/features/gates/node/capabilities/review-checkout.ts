/**
 * `prepareReviewCheckout` (SEC-18): a disposable detached checkout for the reviewer, in an OS
 * temp dir, never the lane worktree.
 *
 * By default the checkout mirrors the lane's working state at HEAD: tracked modifications and
 * untracked (non-ignored) files are copied in, deletions applied, so the reviewer sees what the
 * worker actually produced even if it never committed. Only regular files are copied (no
 * symlinks, so nothing outside the worktree leaks in), each up to 5 MB.
 */
import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { GateJob, PrepareReviewCheckout } from './types';

const run = promisify(execFile);
const MAX_COPY_BYTES = 5 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{7,64}$/i;

/** Hooks and fsmonitor are repo-controlled code; a review checkout must not run them. */
const HARDENING = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

export interface ReviewCheckoutRequest {
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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', [...HARDENING, ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
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

async function mirror(source: string, dest: string): Promise<void> {
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

export interface PrepareReviewCheckoutDeps {
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
    const checkout = await prepareReviewCheckout({
      worktreePath: await deps.worktreeForJob(job),
      root: deps.root,
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
    if ((request.mirrorWorkingTree ?? true) && commit === head) await mirror(source, path);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    await git(source, ['worktree', 'prune']).catch(() => {});
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
        await git(source, ['worktree', 'remove', '--force', realPath]).catch(() => {});
        await rm(dir, { recursive: true, force: true });
        await git(source, ['worktree', 'prune']).catch(() => {});
      })();
      return disposed;
    },
  };
}

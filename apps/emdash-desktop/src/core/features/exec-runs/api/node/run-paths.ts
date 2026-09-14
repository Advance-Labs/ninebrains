/**
 * Paths under `<userData>/ninebrains/runs` and the SEC-14 id rule.
 */
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** SEC-14: ids used in paths are plain segments: no `.`, `..`, `:`, slashes or long names. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSafeId(id: string, what = 'id'): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe ${what}: ${JSON.stringify(id)}`);
  return id;
}

export function ninebrainsDir(userDataDir: string): string {
  if (!isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute');
  return join(userDataDir, 'ninebrains');
}

export function runsDir(userDataDir: string): string {
  return join(ninebrainsDir(userDataDir), 'runs');
}

/** `<runs>/<runId>.jsonl` plus a per-run config dir `<runs>/<runId>/` (settings, mcp.json). */
export function runPaths(userDataDir: string, runId: string) {
  const root = runsDir(userDataDir);
  const id = assertSafeId(runId, 'runId');
  return { root, transcript: join(root, `${id}.jsonl`), configDir: join(root, id) };
}

/** Creates `dir` (and parents) with mode 0700. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * SEC-31/T43: the run directory must be inside one of the allowed roots (compared by realpath),
 * and a root that is itself a symlink is refused. Fails closed: no `process.cwd()` fallback.
 *
 * A cwd that is exactly equal to an allowed root is refused by default: `allowedRoots` here also
 * holds roots that hold *several* runs' directories (e.g. the shared review-checkout root), and
 * running at that shared root itself would reach every run under it, not just the caller's own.
 * `exactRootsAllowed` opts specific roots back in for exactly this case: a root that belongs to a
 * single run (a lane's own worktree) is safe to run at directly. Listing a root there that is not
 * also in `allowedRoots` has no effect.
 *
 * Returns the realpath to spawn in.
 */
export async function resolveRunCwd(
  cwd: string,
  allowedRoots: readonly string[],
  exactRootsAllowed: readonly string[] = []
): Promise<string> {
  if (!isAbsolute(cwd)) throw new Error(`Run cwd must be absolute: ${cwd}`);
  const real = await realpath(cwd);
  const exactAllowed = new Set(
    await Promise.all(exactRootsAllowed.map((root) => realpath(root).catch(() => root)))
  );
  for (const root of allowedRoots) {
    if (!isAbsolute(root)) continue;
    const info = await lstat(root).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
    const realRoot = await realpath(root);
    if (realRoot === real) {
      if (exactAllowed.has(realRoot)) return real;
      continue;
    }
    const rel = relative(realRoot, real);
    if (rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) return real;
  }
  throw new Error(`Run cwd ${cwd} is not inside an allowed worktree root`);
}

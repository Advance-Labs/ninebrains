/**
 * OS sandboxes for the tests gate (SEC-20; review findings H1 and M1).
 *
 * - macOS: `sandbox-exec` with a seatbelt profile. Reads of the M4 secret list, all of
 *   `<userData>`, Ninebrains data and sibling worktrees are denied. Writes go only to the cwd, the
 *   private temp dir and `/dev`. Network is denied except loopback (dev servers, test fixtures).
 * - Linux: bubblewrap. `/` read-only, the cwd read-write, a private `/tmp`, a tmpfs over every
 *   denied directory and `/dev/null` over every denied file, `--unshare-net` (which leaves a
 *   loopback-only network) and `--die-with-parent`.
 * - Linux without `bwrap`, and Windows: no sandbox exists, so the tests gate refuses to run unless
 *   the project opts in with `testsGate.allowUnsandboxed` (accepted risk, THREAT-MODEL §7).
 *
 * Per-project settings keys (the settings UI is wired elsewhere):
 * - `testsGate.allowNetwork` (default false): allow all network, not just loopback.
 * - `testsGate.allowUnsandboxed` (default false): run without an OS sandbox where none exists.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';

export interface TestsGateSettings {
  allowNetwork?: boolean;
  allowUnsandboxed?: boolean;
}

export const TESTS_SANDBOX_REQUIRED =
  'tests gate needs a sandbox (install bubblewrap) or an explicit per-project opt-in';

export class TestsSandboxUnavailableError extends Error {
  constructor(detail: string) {
    super(`${TESTS_SANDBOX_REQUIRED} (testsGate.allowUnsandboxed). ${detail}`);
    this.name = 'TestsSandboxUnavailableError';
  }
}

export interface SandboxPaths {
  /** The command's cwd: a lane worktree or a review checkout. The only writable tree. */
  worktree: string;
  /** Private per-command temp dir, also writable. */
  tempDir: string;
  /** Never readable: secrets, `<userData>`, Ninebrains data, sibling worktrees. */
  deniedPaths: readonly string[];
  /** `testsGate.allowNetwork`. */
  allowNetwork?: boolean;
  /**
   * Readable but never writable, even inside the worktree: the repo's git control files
   * (`gitControlPaths`, T36). They matter when the repo's `.git` sits inside the cwd.
   */
  readOnlyPaths?: readonly string[];
  /** Never renamed or removed, while what is inside stays writable (seatbelt only): git dirs. */
  pinnedPaths?: readonly string[];
}

const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolvePath(p));

export const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/**
 * Realpaths, deduplicated. A denied ancestor of the cwd (e.g. the review-checkout root) is
 * skipped, because denying it would deny the cwd itself.
 */
export function effectiveDenied(worktree: string, denied: readonly string[]): string[] {
  return [...new Set(denied.map(real))].filter((p) => !isInside(worktree, p));
}

const sbplString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const subpaths = (paths: readonly string[]) =>
  paths.map((p) => `(subpath ${sbplString(p)})`).join(' ');
const literals = (paths: readonly string[]) =>
  paths.map((p) => `(literal ${sbplString(p)})`).join(' ');

/** macOS seatbelt profile. Later rules win, so each deny follows the broad allow. */
export function buildSeatbeltProfile(input: SandboxPaths): string {
  const writable = [input.worktree, input.tempDir, '/dev'];
  const denied = effectiveDenied(input.worktree, input.deniedPaths);
  // Path rules: they also stop a lane creating a control file that does not exist yet.
  const readOnly = [...new Set((input.readOnlyPaths ?? []).map(real))];
  const pinned = [...new Set((input.pinnedPaths ?? []).map(real))];
  return [
    '(version 1)',
    '(allow default)',
    ...(denied.length ? [`(deny file-read* file-write* ${subpaths(denied)})`] : []),
    `(deny file-write* (require-not (require-any ${subpaths(writable)})))`,
    ...(readOnly.length || pinned.length
      ? [`(deny file-write* ${[subpaths(readOnly), literals(pinned)].filter(Boolean).join(' ')})`]
      : []),
    ...(input.allowNetwork
      ? []
      : [
          // No outbound network and no Unix sockets (docker.sock, agent sockets)...
          '(deny network*)',
          // ...except loopback, so tests can start and reach their own servers. Checked against
          // real sandbox-exec: `(allow network* (local ip …))` would also open outbound
          // connections, so bind/inbound and outbound are allowed separately.
          '(allow network-bind network-inbound (local ip "localhost:*"))',
          '(allow network-outbound (remote ip "localhost:*"))',
        ]),
  ].join('\n');
}

/**
 * bubblewrap argv (everything before the command). Mount order matters: later mounts cover
 * earlier ones, so the worktree and temp dir binds come last.
 */
export function buildBwrapArgs(input: SandboxPaths): string[] {
  const args = ['--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
  args.push('--tmpfs', '/tmp');
  for (const path of effectiveDenied(input.worktree, input.deniedPaths)) {
    const info = statSafe(path);
    if (!info) continue; // nothing there to hide
    if (info.isDirectory()) args.push('--tmpfs', path);
    else args.push('--ro-bind', '/dev/null', path);
  }
  args.push('--bind', input.worktree, input.worktree);
  // bwrap resolves bind sources on the host, so this survives the tmpfs over /tmp.
  args.push('--bind', input.tempDir, input.tempDir);
  // T36, after the worktree bind so they cover it. A missing path can't be bound without creating
  // it in the user's repo, so it is skipped: only seatbelt stops a lane creating one.
  for (const path of new Set((input.readOnlyPaths ?? []).map(real))) {
    if (statSafe(path)) args.push('--ro-bind', path, path);
  }
  if (!input.allowNetwork) args.push('--unshare-net');
  args.push('--chdir', input.worktree);
  return args;
}

function statSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

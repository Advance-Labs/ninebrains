import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/** SEC-14: ids that become path segments. No `.`, `..`, `:` or separators. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSafeSegment(what: string, id: string): string {
  if (!SAFE_SEGMENT.test(id)) throw new Error(`${what} is not a safe path segment`);
  return id;
}

/** `<userData>/ninebrains`: tokens, lane configs, the evidence store. Denied to every lane (SEC-11). */
export function ninebrainsDataDir(userDataDir: string): string {
  return join(userDataDir, 'ninebrains');
}

export function lanesRoot(userDataDir: string): string {
  return join(ninebrainsDataDir(userDataDir), 'lanes');
}

/**
 * The one path builder for a launch's private directory (SEC-10, SEC-14).
 * Re-validates the id, creates each level 0700, and checks the realpath stays
 * under the lanes root, so a planted symlink cannot redirect the writes.
 */
export function launchDir(userDataDir: string, launchId: string): string {
  assertSafeSegment('launch id', launchId);
  const root = lanesRoot(userDataDir);
  ensurePrivateDir(ninebrainsDataDir(userDataDir));
  ensurePrivateDir(root);
  const dir = join(root, launchId);
  ensurePrivateDir(dir);
  const real = realpathSync(dir);
  const realRoot = realpathSync(root);
  const rel = relative(realRoot, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('launch directory escapes the lanes root');
  }
  return dir;
}

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
}

/**
 * Writes a file that is 0600 from the moment it exists: the old file is
 * removed and the new one is created with the `wx` flag and mode 0600, never
 * created first and chmodded later (SEC-10).
 */
export function writePrivateFileSync(path: string, content: string): void {
  rmSync(path, { force: true });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

export function removeLaunchDir(userDataDir: string, launchId: string): void {
  if (!SAFE_SEGMENT.test(launchId)) return;
  rmSync(join(lanesRoot(userDataDir), launchId), { recursive: true, force: true });
}

/**
 * Boot sweep (SEC-10): every launch dir left by a previous run holds a token
 * that is already dead, since tokens live only in main's memory. Delete them all.
 */
export function sweepLaunchDirs(userDataDir: string): number {
  let entries: string[];
  try {
    entries = readdirSync(lanesRoot(userDataDir));
  } catch {
    return 0;
  }
  for (const entry of entries) removeLaunchDir(userDataDir, entry);
  return entries.length;
}

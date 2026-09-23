import { promises as fsp } from 'node:fs';
import { readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app } from 'electron';
import { log } from '@main/lib/logger';
import { SHA256_RE_HEX } from './integrity';
import type { PendingUpdate } from './types';

export const PENDING_FILE = 'pending.json';

/** An artifact name that cannot escape the staged/ directory. */
function isSafeArtifactName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    basename(name) === name &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  );
}

/** Where staged installers and the pending marker live, alongside the app's user data. */
export function updatesRootDirectory(): string {
  return join(app.getPath('userData'), 'updates');
}

export function stagedFilePath(rootDir: string | undefined, artifactName: string): string {
  return join(rootDir ?? updatesRootDirectory(), 'staged', artifactName);
}

export function pendingFilePath(rootDir: string | undefined): string {
  return join(rootDir ?? updatesRootDirectory(), PENDING_FILE);
}

/**
 * Records that a fully verified installer is staged and waiting for the next launch. The marker
 * only names the artifact; its absolute path is recomputed from the updates root on read so a
 * moved data directory cannot point the apply step at an attacker-chosen path.
 */
export async function writePendingUpdate(
  pending: Omit<PendingUpdate, 'stagedPath'>,
  rootDir?: string
): Promise<PendingUpdate> {
  if (!isSafeArtifactName(pending.artifactName)) {
    throw new Error(`Refusing to stage update with unsafe artifact name "${pending.artifactName}"`);
  }
  const root = rootDir ?? updatesRootDirectory();
  await fsp.mkdir(join(root, 'staged'), { recursive: true });
  const record: PendingUpdate = {
    ...pending,
    stagedPath: stagedFilePath(root, pending.artifactName),
  };
  const file = pendingFilePath(root);
  const temporary = `${file}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await fsp.rename(temporary, file);
  return record;
}

export async function readPendingUpdate(rootDir?: string): Promise<PendingUpdate | null> {
  const root = rootDir ?? updatesRootDirectory();
  let raw: string;
  try {
    raw = await fsp.readFile(pendingFilePath(root), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearPendingUpdate(root);
    return null;
  }
  const candidate = parsed as Partial<PendingUpdate>;
  if (
    typeof candidate.version !== 'string' ||
    typeof candidate.artifactName !== 'string' ||
    !isSafeArtifactName(candidate.artifactName) ||
    typeof candidate.sha256 !== 'string' ||
    !SHA256_RE_HEX.test(candidate.sha256) ||
    typeof candidate.size !== 'number'
  ) {
    await clearPendingUpdate(root);
    return null;
  }
  return {
    version: candidate.version,
    artifactName: candidate.artifactName,
    sha256: candidate.sha256,
    size: candidate.size,
    requestedAt: candidate.requestedAt ?? new Date().toISOString(),
    stagedPath: stagedFilePath(root, candidate.artifactName),
  };
}

/** Removes the marker and the staged artifact so a broken or stale update never reapplies. */
export async function clearPendingUpdate(rootDir?: string): Promise<void> {
  const root = rootDir ?? updatesRootDirectory();
  const pending = await readPendingUpdateUnchecked(root);
  // Derive the path from the marker's artifact name, never from its stored path: a hand-crafted
  // marker must not make the cleanup step delete an arbitrary file outside staged/.
  if (pending && isSafeArtifactName(pending.artifactName)) {
    await fsp
      .rm(stagedFilePath(root, pending.artifactName), { force: true })
      .catch(() => undefined);
  }
  await fsp.rm(pendingFilePath(root), { force: true }).catch(() => undefined);
}

async function readPendingUpdateUnchecked(rootDir: string): Promise<PendingUpdate | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(pendingFilePath(rootDir), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as PendingUpdate;
  } catch {
    return null;
  }
}

/**
 * Synchronous clear for the Windows quit path: the marker must be gone before `will-quit` spawns
 * the installer, otherwise the next open would re-apply the same staged installer forever.
 */
export function clearPendingUpdateSync(rootDir?: string): void {
  const root = rootDir ?? updatesRootDirectory();
  try {
    let raw: string | null = null;
    try {
      raw = readFileSync(pendingFilePath(root), 'utf8');
    } catch {
      // No marker to clean.
    }
    if (raw) {
      const pending = JSON.parse(raw) as PendingUpdate;
      if (isSafeArtifactName(pending.artifactName)) {
        rmSync(stagedFilePath(root, pending.artifactName), { force: true });
      }
    }
    rmSync(pendingFilePath(root), { force: true });
  } catch (error) {
    log.warn('Failed to clear pending update synchronously', { error });
  }
}

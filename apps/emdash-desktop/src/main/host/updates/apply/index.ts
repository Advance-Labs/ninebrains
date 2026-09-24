import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { log } from '@main/lib/logger';
import type { PendingUpdate } from '../types';

export async function sha256FileHex(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function verifyStagedHash(pending: PendingUpdate): Promise<void> {
  return sha256FileHex(pending.stagedPath).then((actual) => {
    if (actual !== pending.sha256) {
      throw new Error(
        `Staged update hash mismatch: expected ${pending.sha256}, got ${actual}; refusing to install`
      );
    }
  });
}

export type ApplyResult = {
  applied: boolean;
};

/**
 * Applies a fully verified staged update in place by swapping the running app for the new bytes.
 *
 *  - macOS: extracts the updater .zip beside the running .app, swaps it in, and relaunches.
 *  - Linux (AppImage): copies the staged AppImage over the currently running image and relaunches.
 *  - Windows: not handled here; the service launches the staged NSIS installer from its
 *    `will-quit` hook (files unlocked) and the installer relaunches the app (nsis.runAfterFinish).
 *
 * The staged file's sha256 is recomputed here so nothing is ever installed that was not the exact
 * bytes the signed release digest named.
 */
export async function applyStagedUpdate(pending: PendingUpdate): Promise<ApplyResult> {
  await verifyStagedHash(pending);
  switch (process.platform) {
    case 'darwin':
      await installMacAppSwap(pending);
      return { applied: true };
    case 'linux':
      await installLinuxAppImage(pending);
      return { applied: true };
    case 'win32':
      throw new Error('Windows updates are applied by the installer at app quit, not in place');
    default:
      throw new Error(`Update install is not supported on ${process.platform}`);
  }
}

/**
 * The absolute path of the running .app bundle (…/Ninebrains.app). Walks up from the executable so
 * it works whether installed in /Applications, a per-user location, or a custom worktree.
 */
export function resolveMacBundlePath(execPath = process.execPath): string {
  let dir = dirname(execPath);
  while (dir && !dir.endsWith('.app') && dir !== dirname(dir)) dir = dirname(dir);
  if (!dir.endsWith('.app')) throw new Error('Could not locate the running .app bundle');
  return dir;
}

/** Extracts a mac updater .zip (the `dmg`/`zip` target, containing the .app) into `destDir`. */
export async function extractMacZip(zipPath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });
  const result = spawnSync('/usr/bin/ditto', ['-xk', zipPath, destDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? 'unknown ditto error';
    throw new Error(`Extracting updater archive failed: ${stderr.trim()}`);
  }
}

async function installMacAppSwap(pending: PendingUpdate): Promise<void> {
  const bundlePath = resolveMacBundlePath();
  const appName = basename(bundlePath);
  const destinationRoot = dirname(bundlePath);
  const stagingDir = join(destinationRoot, `.ninebrains-update-${pending.version}`);
  const rollbackDir = join(
    destinationRoot,
    `.ninebrains-rollback-${pending.version}-${Date.now()}`
  );

  await fsp.rm(stagingDir, { recursive: true, force: true });
  await extractMacZip(pending.stagedPath, stagingDir);

  const incoming = join(stagingDir, appName);
  const incomingStat = await fsp.stat(incoming).catch(() => null);
  if (!incomingStat?.isDirectory()) {
    throw new Error(`Updater archive did not contain ${appName}`);
  }

  // rename() over a live bundle is atomic on the same volume (staging sits next to the bundle).
  await fsp.rename(bundlePath, rollbackDir);
  try {
    await fsp.rename(incoming, bundlePath);
  } catch (error) {
    await fsp.rename(rollbackDir, bundlePath).catch(() => undefined);
    throw error;
  }
  // The swap is done: from here the update IS applied, so nothing below may reject. `rollbackDir`
  // is the bundle THIS process is executing from — macOS will not unlink a running binary or the
  // open app.asar, so the recursive walk leaves those behind and the final rmdir returns
  // ENOTEMPTY, every time, on every Mac. Letting that reject failed an install that had already
  // succeeded: the caller rolled the UI back to "Restart now", never relaunched, and each retry
  // swapped the already-updated bundle again and stranded another copy of it.
  // Both directories are swept on the next boot, when the old bundle is no longer running.
  await discard(rollbackDir);
  await discard(stagingDir);
  log.info('Applied Ninebrains update in place', {
    from: pending.version,
    bundle: bundlePath,
  });
}

/** Removes a leftover update directory, or logs why it could not go. Never throws. */
async function discard(dir: string): Promise<void> {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (error) {
    log.info('Leaving an update directory for the next boot to sweep', {
      dir,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const LEFTOVER_DIR = /^\.ninebrains-(rollback|update)-/;

/**
 * Removes the `.ninebrains-rollback-*` / `.ninebrains-update-*` directories an in-place update
 * leaves beside the bundle. Called at boot, when the running process is the NEW bundle and the
 * old one is finally free to delete. Best effort: anything still held is left for the next boot.
 */
export async function sweepLeftoverUpdateDirs(destinationRoot: string): Promise<number> {
  let swept = 0;
  let entries: string[];
  try {
    entries = await fsp.readdir(destinationRoot);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!LEFTOVER_DIR.test(entry)) continue;
    const dir = join(destinationRoot, entry);
    try {
      await fsp.rm(dir, { recursive: true, force: true });
      swept += 1;
    } catch {
      // Still in use (an older copy of this app is running from it). Next boot gets it.
    }
  }
  if (swept > 0) log.info('Swept leftover update directories', { count: swept, destinationRoot });
  return swept;
}

async function installLinuxAppImage(pending: PendingUpdate): Promise<void> {
  const target = runningAppImagePath();
  const destinationRoot = dirname(target);
  const temporary = join(destinationRoot, `.ninebrains-update-${pending.version}.AppImage.part`);
  await fsp.copyFile(pending.stagedPath, temporary);
  await fsp.chmod(temporary, 0o755);
  await fsp.rename(temporary, target);
  log.info('Applied Ninebrains AppImage update in place', {
    version: pending.version,
    image: target,
  });
}

function runningAppImagePath(): string {
  const fromEnv = process.env.APPIMAGE;
  if (fromEnv && fromEnv.endsWith('.AppImage')) return fromEnv;
  if (process.execPath.endsWith('.AppImage')) return process.execPath;
  throw new Error('Could not locate the running AppImage to replace');
}

/**
 * Launches the staged NSIS installer silently into the current install directory. The caller runs
 * this from `will-quit`, after the running exe is about to release its lock. `installDir` is the
 * final argument by NSIS convention; leaving it pointing at the current install keeps the shell
 * variables (Start Menu, uninstall entries) intact.
 */
export function spawnWindowsInstaller(stagedPath: string): void {
  const installDir = dirname(process.execPath);
  const installer = spawn(stagedPath, ['/S', `/D=${installDir}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  installer.unref();
  log.info('Launched Ninebrains Windows installer for brand replacement');
}

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpdate } from '../types';
import {
  applyStagedUpdate,
  resolveMacBundlePath,
  sha256FileHex,
  sweepLeftoverUpdateDirs,
} from './index';

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-apply-'));
});

function pendingFor(
  content: string,
  artifactName = 'Ninebrains-0.2.2-mac-arm64.zip'
): PendingUpdate {
  writeFileSync(join(dir, artifactName), content);
  return {
    version: '0.2.2',
    artifactName,
    sha256: createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content),
    stagedPath: join(dir, artifactName),
    requestedAt: new Date().toISOString(),
  };
}

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sha256FileHex', () => {
  it('hashes a file', async () => {
    writeFileSync(join(dir, 'a.bin'), 'bytes');
    expect(await sha256FileHex(join(dir, 'a.bin'))).toBe(
      createHash('sha256').update('bytes').digest('hex')
    );
  });
});

describe('resolveMacBundlePath', () => {
  it('walks up to the .app bundle from the embedded executable', () => {
    expect(resolveMacBundlePath('/Applications/Ninebrains.app/Contents/MacOS/Ninebrains')).toBe(
      '/Applications/Ninebrains.app'
    );
    expect(resolveMacBundlePath('/tmp/Ninebrains.app/Contents/MacOS/Ninebrains')).toBe(
      '/tmp/Ninebrains.app'
    );
  });

  it('throws when no bundle is above the executable', () => {
    expect(() => resolveMacBundlePath('/usr/bin/foo')).toThrow(
      /Could not locate the running \.app/
    );
  });
});

describe('applyStagedUpdate', () => {
  it('rejects the update when the staged file no longer matches its recorded hash', async () => {
    const pending = pendingFor('fresh bytes');
    // Poison the staged file after the marker was written.
    writeFileSync(pending.stagedPath, 'tampered bytes');
    await expect(applyStagedUpdate(pending)).rejects.toThrow(/hash mismatch/);
  });

  it('refuses to run on Windows with the installer path', async () => {
    const pending = pendingFor('bytes', 'Ninebrains-0.2.2-win-x64.exe');
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await expect(applyStagedUpdate(pending)).rejects.toThrow(
        /are applied by the installer at app quit/
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('applies an AppImage by swapping the running image', async () => {
    const originalPlatform = process.platform;
    const originalExec = process.execPath;
    const originalAppImage = process.env.APPIMAGE;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    Object.defineProperty(process, 'execPath', { value: '/nonexistent' });
    Object.defineProperty(process, 'env', {
      value: { ...process.env, APPIMAGE: join(dir, 'Ninebrains.AppImage') },
    });
    writeFileSync(join(dir, 'Ninebrains.AppImage'), 'old');
    const pending = pendingFor('new image bytes', 'Ninebrains-0.2.2-linux-x86_64.AppImage');
    try {
      await applyStagedUpdate(pending);
      expect(await fsp.readFile(join(dir, 'Ninebrains.AppImage'), 'utf8')).toBe('new image bytes');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      Object.defineProperty(process, 'execPath', { value: originalExec });
      if (originalAppImage === undefined) delete process.env.APPIMAGE;
      else
        Object.defineProperty(process, 'env', {
          value: { ...process.env, APPIMAGE: originalAppImage },
        });
    }
  });
});

describe('sweepLeftoverUpdateDirs', () => {
  it('removes rollback and staging leftovers and nothing else', async () => {
    await fsp.mkdir(join(dir, '.ninebrains-rollback-0.2.2-canary.8-1790268341887'), {
      recursive: true,
    });
    await fsp.mkdir(join(dir, '.ninebrains-update-0.2.2-canary.8', 'Contents'), {
      recursive: true,
    });
    writeFileSync(join(dir, '.ninebrains-update-0.2.2-canary.8', 'Contents', 'big.asar'), 'bytes');
    await fsp.mkdir(join(dir, 'Ninebrains Canary.app'), { recursive: true });
    await fsp.mkdir(join(dir, '.ninebrains-something-else'), { recursive: true });

    expect(await sweepLeftoverUpdateDirs(dir)).toBe(2);

    const left = (await fsp.readdir(dir)).sort();
    expect(left).toContain('Ninebrains Canary.app');
    expect(left).toContain('.ninebrains-something-else');
    expect(left.some((name) => name.startsWith('.ninebrains-rollback-'))).toBe(false);
    expect(left.some((name) => name.startsWith('.ninebrains-update-'))).toBe(false);
  });

  it('returns 0 rather than throwing when the directory does not exist', async () => {
    expect(await sweepLeftoverUpdateDirs(join(dir, 'nope'))).toBe(0);
  });
});

// The bug this guards: `installMacAppSwap` renames the live bundle aside, swaps the new one in,
// then removes the old one — but that is the bundle the process is executing from, and macOS will
// not unlink a running binary or an open app.asar, so the rm ends in ENOTEMPTY on every Mac. It
// used to reject an install that had already fully succeeded, so the app never relaunched and
// every retry stranded another ~400 MB copy of the bundle beside it.
describe.skipIf(process.platform !== 'darwin')('applyStagedUpdate on macOS', () => {
  async function zippedBundle(appName: string, marker: string): Promise<string> {
    const source = join(dir, 'src');
    await fsp.mkdir(join(source, appName, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(source, appName, 'Contents', 'MacOS', 'exe'), marker);
    const zip = join(dir, 'Ninebrains-0.2.2-mac-arm64.zip');
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('/usr/bin/ditto', ['-ck', '--keepParent', join(source, appName), zip]);
    expect(result.status).toBe(0);
    return zip;
  }

  it('still applies when the old bundle cannot be deleted', async () => {
    const appName = 'Ninebrains Canary.app';
    const zip = await zippedBundle(appName, 'new bytes');
    const installed = join(dir, appName);
    await fsp.mkdir(join(installed, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(installed, 'Contents', 'MacOS', 'exe'), 'old bytes');

    const pending = {
      version: '0.2.2',
      artifactName: 'Ninebrains-0.2.2-mac-arm64.zip',
      sha256: createHash('sha256')
        .update(await fsp.readFile(zip))
        .digest('hex'),
      size: (await fsp.stat(zip)).size,
      stagedPath: zip,
      requestedAt: new Date().toISOString(),
    } satisfies PendingUpdate;

    const execPath = join(installed, 'Contents', 'MacOS', 'exe');
    const originalExec = process.execPath;
    Object.defineProperty(process, 'execPath', { value: execPath });

    // Exactly what macOS does to the bundle we are running from.
    const realRm = fsp.rm;
    const rm = vi.spyOn(fsp, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes('.ninebrains-rollback-')) {
        throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${target}'`), {
          code: 'ENOTEMPTY',
        });
      }
      return realRm(target, options);
    });

    try {
      await expect(applyStagedUpdate(pending)).resolves.toEqual({ applied: true });
      // The swap still happened, which is the whole point: the install is not failed by cleanup.
      expect(await fsp.readFile(join(installed, 'Contents', 'MacOS', 'exe'), 'utf8')).toBe(
        'new bytes'
      );
    } finally {
      rm.mockRestore();
      Object.defineProperty(process, 'execPath', { value: originalExec });
    }
  });
});

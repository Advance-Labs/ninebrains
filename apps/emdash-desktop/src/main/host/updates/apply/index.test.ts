import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpdate } from '../types';
import { applyStagedUpdate, resolveMacBundlePath, sha256FileHex } from './index';

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

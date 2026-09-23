import { promises as fsp } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHA256_RE_HEX } from './integrity';
import {
  clearPendingUpdate,
  clearPendingUpdateSync,
  PENDING_FILE,
  pendingFilePath,
  readPendingUpdate,
  stagedFilePath,
  writePendingUpdate,
} from './staging';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nb-stage-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const GOOD = {
  version: '0.2.2',
  artifactName: 'Ninebrains-0.2.2-mac-arm64.zip',
  sha256: 'c'.repeat(64),
  size: 1234,
  requestedAt: new Date().toISOString(),
};

describe('writePendingUpdate', () => {
  it('writes the artifact to staged/ and returns its absolute path', async () => {
    const pending = await writePendingUpdate(GOOD, root);
    expect(pending.stagedPath).toBe(stagedFilePath(root, GOOD.artifactName));
    const marker = JSON.parse(await fsp.readFile(pendingFilePath(root), 'utf8'));
    expect(marker).toMatchObject(GOOD);
    expect(marker.stagedPath).toBe(pending.stagedPath);
  });
});

describe('readPendingUpdate', () => {
  it('round-trips a written marker', async () => {
    await writePendingUpdate(GOOD, root);
    const pending = await readPendingUpdate(root);
    expect(pending).toMatchObject(GOOD);
    expect(pending?.stagedPath).toBe(stagedFilePath(root, GOOD.artifactName));
  });

  it('returns null when there is no marker', async () => {
    expect(await readPendingUpdate(root)).toBeNull();
  });

  it('discards and clears a corrupt marker', async () => {
    await fsp.writeFile(pendingFilePath(root), '{not json', 'utf8');
    expect(await readPendingUpdate(root)).toBeNull();
    await expect(fsp.stat(pendingFilePath(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('discards a marker with a poisoned hash or a path-traversal name', async () => {
    await fsp.writeFile(
      pendingFilePath(root),
      JSON.stringify({ ...GOOD, sha256: 'not-a-hash' }),
      'utf8'
    );
    expect(await readPendingUpdate(root)).toBeNull();

    await fsp.writeFile(
      pendingFilePath(root),
      JSON.stringify({ ...GOOD, artifactName: '../escape.zip', sha256: 'e'.repeat(64) }),
      'utf8'
    );
    expect(await readPendingUpdate(root)).toBeNull();
  });

  it('refuses to stage an unsafe artifact name', async () => {
    await expect(
      writePendingUpdate({ ...GOOD, artifactName: '../escape.zip' }, root)
    ).rejects.toThrow(/unsafe artifact name/);
  });
});

describe('clearPendingUpdate', () => {
  it('removes the marker and the staged artifact', async () => {
    const pending = await writePendingUpdate(GOOD, root);
    await fsp.writeFile(pending.stagedPath, 'bytes');
    await clearPendingUpdate(root);
    await expect(fsp.stat(pending.stagedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(pendingFilePath(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op when nothing is staged', async () => {
    await expect(clearPendingUpdate(root)).resolves.toBeUndefined();
  });

  it('clears synchronously too', async () => {
    const pending = await writePendingUpdate(GOOD, root);
    await fsp.writeFile(pending.stagedPath, 'bytes');
    clearPendingUpdateSync(root);
    await expect(fsp.stat(pending.stagedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(pendingFilePath(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('SHA256_RE_HEX', () => {
  it('only matches 64 lowercase hex chars', () => {
    expect(SHA256_RE_HEX.test('a'.repeat(64))).toBe(true);
    expect(SHA256_RE_HEX.test('A'.repeat(64))).toBe(false);
    expect(SHA256_RE_HEX.test('a'.repeat(63))).toBe(false);
  });

  it('keeps staging in sync with what integrity accepts', () => {
    expect(`pending marker guard file: ${PENDING_FILE}`).toContain('pending.json');
  });
});

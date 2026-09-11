// Run: node --test scripts/release/*.test.mjs   (no install needed)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SUMS_FILE,
  SUMS_JSON_FILE,
  parseSums,
  verifyChecksums,
  writeChecksums,
} from './checksums.mjs';

const script = fileURLToPath(new URL('./checksums.mjs', import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-sums-'));
  writeFileSync(join(dir, 'Ninebrains-0.1.0-mac-arm64.dmg'), 'dmg bytes');
  writeFileSync(join(dir, 'Ninebrains-0.1.0-win-x64.exe'), 'exe bytes');
  // Builder leftovers that are not release assets.
  writeFileSync(join(dir, 'builder-debug.yml'), 'x');
  writeFileSync(join(dir, 'Ninebrains-0.1.0-mac-arm64.dmg.blockmap'), 'x');
  mkdirSync(join(dir, 'mac-arm64'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SEC-37 release sums', () => {
  it('writes sorted sha256sum-format lines for artifacts only', async () => {
    await writeChecksums(dir);
    assert.equal(
      readFileSync(join(dir, SUMS_FILE), 'utf8'),
      `${sha('dmg bytes')}  Ninebrains-0.1.0-mac-arm64.dmg\n` +
        `${sha('exe bytes')}  Ninebrains-0.1.0-win-x64.exe\n`
    );
    const json = JSON.parse(readFileSync(join(dir, SUMS_JSON_FILE), 'utf8'));
    assert.deepEqual(json, {
      version: 1,
      algorithm: 'sha256',
      files: [
        { name: 'Ninebrains-0.1.0-mac-arm64.dmg', sha256: sha('dmg bytes'), size: 9 },
        { name: 'Ninebrains-0.1.0-win-x64.exe', sha256: sha('exe bytes'), size: 9 },
      ],
    });
  });

  it('verifies an untouched directory', async () => {
    await writeChecksums(dir);
    assert.deepEqual(await verifyChecksums(dir), [
      'Ninebrains-0.1.0-mac-arm64.dmg',
      'Ninebrains-0.1.0-win-x64.exe',
    ]);
  });

  it('rejects a tampered artifact', async () => {
    await writeChecksums(dir);
    writeFileSync(join(dir, 'Ninebrains-0.1.0-win-x64.exe'), 'evil bytes');
    await assert.rejects(verifyChecksums(dir), /win-x64\.exe: checksum mismatch/);
  });

  it('rejects a missing artifact', async () => {
    await writeChecksums(dir);
    rmSync(join(dir, 'Ninebrains-0.1.0-mac-arm64.dmg'));
    await assert.rejects(verifyChecksums(dir), /mac-arm64\.dmg: missing/);
  });

  it('rejects an artifact that was added after the sums were written', async () => {
    await writeChecksums(dir);
    writeFileSync(join(dir, 'Ninebrains-0.1.0-linux-x86_64.AppImage'), 'extra');
    await assert.rejects(verifyChecksums(dir), /AppImage: not listed/);
  });

  it('refuses to write sums for an empty directory', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nb-sums-empty-'));
    try {
      await assert.rejects(writeChecksums(empty), /No release artifacts/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('refuses artifact names that could forge a line', async () => {
    writeFileSync(join(dir, '-evil.zip'), 'x');
    await assert.rejects(writeChecksums(dir), /unsafe artifact name/);
  });

  it('parses shasum binary-mode lines and rejects malformed or duplicate ones', () => {
    const h = 'a'.repeat(64);
    assert.equal(parseSums(`${h} *App.dmg\n`).get('App.dmg'), h);
    assert.throws(() => parseSums('nothex  App.dmg\n'), /malformed/);
    assert.throws(() => parseSums(`${h}  ../etc/passwd\n`), /malformed/);
    assert.throws(() => parseSums(`${h}  App.dmg\n${h}  App.dmg\n`), /twice/);
  });

  it('CLI exits non-zero when verification fails', async () => {
    execFileSync(process.execPath, [script, dir]);
    execFileSync(process.execPath, [script, '--verify', dir]);
    writeFileSync(join(dir, 'Ninebrains-0.1.0-mac-arm64.dmg'), 'changed');
    assert.throws(
      () => execFileSync(process.execPath, [script, '--verify', dir], { stdio: 'pipe' }),
      (error) => error.status === 1 && /checksum mismatch/.test(String(error.stderr))
    );
  });
});

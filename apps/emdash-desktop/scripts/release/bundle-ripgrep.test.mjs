// Run: node --test scripts/release/*.test.mjs   (offline: no download happens here)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { downloadVerified, fetchBytes, ripgrepAsset, verifySha256 } from './bundle-ripgrep.mjs';

const configs = {
  stable: (await import('../../electron-builder.config.ts')).default,
  canary: (await import('../../electron-builder.canary.config.ts')).default,
};

describe('bundled ripgrep', () => {
  it('pins a build for every packaged platform and arch', () => {
    const pinned = (config, os, platform) =>
      config[os].target.flatMap((t) => t.arch).map((arch) => ripgrepAsset(platform, arch));
    for (const config of Object.values(configs)) {
      assert.ok(pinned(config, 'mac', 'darwin').length > 0);
      pinned(config, 'linux', 'linux');
      pinned(config, 'win', 'win32');
    }
    assert.equal(ripgrepAsset('win32', 'x64').binary, 'rg.exe');
    assert.throws(() => ripgrepAsset('linux', 'arm64'), /No pinned ripgrep build/);
  });

  it('refuses a download that does not match the pinned SHA-256', () => {
    assert.throws(() => verifySha256(Buffer.from('tampered'), '0'.repeat(64), 'rg.tar.gz'));
  });

  describe('download', () => {
    const sleep = async () => {};
    const res = (status, body = 'x') => ({
      ok: status < 400,
      status,
      arrayBuffer: async () => Buffer.from(body),
    });

    it('retries a network error and a 429, then succeeds', async () => {
      const replies = [
        () => {
          throw new Error('ECONNRESET');
        },
        () => res(429),
        () => res(200, 'ok'),
      ];
      let calls = 0;
      const out = await fetchBytes('u', { sleep, fetchImpl: async () => replies[calls++]() });
      assert.equal(out.toString(), 'ok');
      assert.equal(calls, 3);
    });

    it('gives up after 3 attempts', async () => {
      let calls = 0;
      await assert.rejects(
        fetchBytes('u', { sleep, fetchImpl: async () => (calls++, res(500)) }),
        /HTTP 500/
      );
      assert.equal(calls, 3);
    });

    it('does not retry a 404', async () => {
      let calls = 0;
      await assert.rejects(fetchBytes('u', { sleep, fetchImpl: async () => (calls++, res(404)) }));
      assert.equal(calls, 1);
    });

    it('does not retry a checksum mismatch, and downloads a good asset once', async () => {
      const bad = { file: 'bad', url: 'u', sha256: '0'.repeat(64) };
      let calls = 0;
      const fetchImpl = async () => (calls++, res(200, 'tampered'));
      await assert.rejects(downloadVerified(bad, { sleep, fetchImpl }), /does not match/);
      assert.equal(calls, 1);

      const body = 'payload';
      const sha = (await import('node:crypto')).createHash('sha256').update(body).digest('hex');
      const good = { file: 'good', url: 'u', sha256: sha };
      calls = 0;
      const ok = async () => (calls++, res(200, body));
      await downloadVerified(good, { fetchImpl: ok });
      await downloadVerified(good, { fetchImpl: ok });
      assert.equal(calls, 1);
    });
  });

  for (const [name, config] of Object.entries(configs)) {
    it(`${name}: runs the hook from an absolute path`, () => {
      assert.match(config.afterPack, /[/\\]scripts[/\\]release[/\\]bundle-ripgrep\.mjs$/);
      assert.doesNotThrow(() => structuredClone(config));
    });
  }
});

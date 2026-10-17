// Run: node --test scripts/release/*.test.mjs   (offline: no download happens here)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ripgrepAsset, verifySha256 } from './bundle-ripgrep.mjs';

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

  for (const [name, config] of Object.entries(configs)) {
    it(`${name}: runs the hook from an absolute path`, () => {
      assert.match(config.afterPack, /[/\\]scripts[/\\]release[/\\]bundle-ripgrep\.mjs$/);
      assert.doesNotThrow(() => structuredClone(config));
    });
  }
});

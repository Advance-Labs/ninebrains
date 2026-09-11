// Run: node --test scripts/release/*.test.mjs   (no install needed: the configs and signing.ts
// only import types from electron-builder, which Node's type stripping erases)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveMacSigning, resolveWinSigning } from './lib/signing.ts';

const configs = {
  stable: (await import('../../electron-builder.config.ts')).default,
  canary: (await import('../../electron-builder.canary.config.ts')).default,
};

function publishEntries(config) {
  if (config.publish == null) return [];
  return Array.isArray(config.publish) ? config.publish : [config.publish];
}

describe('SEC-36 updater disabled', () => {
  for (const [name, config] of Object.entries(configs)) {
    it(`${name}: has no publish provider, so no app-update.yml is packaged`, () => {
      assert.deepEqual(publishEntries(config), []);
    });

    it(`${name}: never points at upstream's feed`, () => {
      const text = JSON.stringify(config);
      assert.doesNotMatch(text, /generalaction/i);
      assert.doesNotMatch(text, /releases\.emdash\.sh/);
      for (const entry of publishEntries(config)) {
        assert.equal(entry.owner, 'Advance-Labs');
        assert.equal(entry.repo, 'ninebrains');
      }
    });

    it(`${name}: builds no differential update packages`, () => {
      assert.equal(config.nsis?.differentialPackage, false);
    });
  }
});

describe('release targets', () => {
  it('stable artifact names carry product, version, os and arch', () => {
    assert.equal(configs.stable.artifactName, 'Ninebrains-${version}-${os}-${arch}.${ext}');
    assert.equal(configs.stable.appId, 'dev.advancelabs.ninebrains');
  });

  it('canary artifact names have no spaces', () => {
    assert.doesNotMatch(configs.canary.artifactName, / /);
  });

  it('stable targets: mac dmg+zip arm64+x64, win nsis x64, linux AppImage+deb x64', () => {
    const targets = (list) => list.map((t) => `${t.target}:${t.arch.join('+')}`);
    assert.deepEqual(targets(configs.stable.mac.target), ['dmg:arm64+x64', 'zip:arm64+x64']);
    assert.deepEqual(targets(configs.stable.win.target), ['nsis:x64']);
    assert.deepEqual(targets(configs.stable.linux.target), ['AppImage:x64', 'deb:x64']);
  });
});

describe('signing is switched by env only', () => {
  it('no env: ad-hoc mac, no notarization, unsigned windows, never throws', () => {
    assert.deepEqual(resolveMacSigning({}), {
      identity: '-',
      hardenedRuntime: true,
      notarize: false,
    });
    assert.deepEqual(resolveWinSigning({}), { azureSignOptions: undefined });
  });

  it('empty-string secrets (unset GitHub secrets) count as absent', () => {
    const env = { CSC_LINK: '', APPLE_ID: '', AZURE_TENANT_ID: '', NINEBRAINS_AZURE_PUBLISHER: ' ' };
    assert.equal(resolveMacSigning(env).identity, '-');
    assert.equal(resolveWinSigning(env).azureSignOptions, undefined);
  });

  it('the committed configs match the no-env defaults in this test environment', () => {
    if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.AZURE_TENANT_ID) return;
    assert.equal(configs.stable.mac.identity, '-');
    assert.equal(configs.stable.mac.notarize, false);
    assert.equal(configs.stable.win.azureSignOptions, undefined);
  });

  it('a certificate turns on real signing; notarization needs a complete credential set', () => {
    assert.deepEqual(resolveMacSigning({ CSC_LINK: 'cert.p12' }), {
      identity: undefined,
      hardenedRuntime: true,
      notarize: false,
    });
    const appleId = { APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' };
    assert.equal(resolveMacSigning({ CSC_LINK: 'cert.p12', ...appleId }).notarize, true);
    const apiKey = { APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' };
    assert.equal(resolveMacSigning({ CSC_NAME: 'Developer ID', ...apiKey }).notarize, true);
  });

  it('partial or orphaned credentials fail loudly instead of shipping unsigned by accident', () => {
    assert.throws(
      () => resolveMacSigning({ CSC_LINK: 'cert.p12', APPLE_ID: 'a' }),
      /missing: APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID/
    );
    assert.throws(
      () =>
        resolveMacSigning({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' }),
      /no CSC_LINK/
    );
    assert.throws(
      () => resolveWinSigning({ AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's' }),
      /needs both/
    );
  });

  it('a complete Azure set produces azureSignOptions', () => {
    const env = {
      AZURE_TENANT_ID: 't',
      AZURE_CLIENT_ID: 'c',
      AZURE_CLIENT_SECRET: 's',
      NINEBRAINS_AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
      NINEBRAINS_AZURE_SIGNING_ACCOUNT: 'advancelabs',
      NINEBRAINS_AZURE_CERT_PROFILE: 'ninebrains-public',
      NINEBRAINS_AZURE_PUBLISHER: 'Advance Labs Inc.',
    };
    assert.deepEqual(resolveWinSigning(env).azureSignOptions, {
      publisherName: 'Advance Labs Inc.',
      endpoint: 'https://eus.codesigning.azure.net/',
      codeSigningAccountName: 'advancelabs',
      certificateProfileName: 'ninebrains-public',
    });
  });
});

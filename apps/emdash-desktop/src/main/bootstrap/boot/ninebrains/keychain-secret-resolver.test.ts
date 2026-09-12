import type { Secret } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { createEnvSecretResolver } from '@core/features/packs/node/secrets';
import {
  createKeychainSecretResolver,
  createKeychainSecretStore,
  PACK_SECRET_KEY_PREFIX,
  type KeychainSecretSink,
} from './keychain-secret-resolver';

/** An in-memory stand-in for upstream's EncryptedAppSecretsStore. */
function fakeKeychain(options: { encryptionAvailable?: boolean } = {}) {
  const rows = new Map<string, string>();
  const sink: KeychainSecretSink = {
    async getSecret(key) {
      const value = rows.get(key);
      return value === undefined ? null : { expose: () => value };
    },
    async setSecret(key: string, value: Secret<string>) {
      if (options.encryptionAvailable === false) {
        throw new Error('Secure secret storage is unavailable on this system.');
      }
      rows.set(key, value.expose());
    },
    async deleteSecret(key) {
      rows.delete(key);
    },
  };
  return { sink, rows };
}

describe('keychain pack secret store', () => {
  it('writes under the ninebrains.pack. prefix, answers set or missing, and clears', async () => {
    const { sink, rows } = fakeKeychain();
    const store = createKeychainSecretStore(sink);
    expect(await store.has('GOOGLE_ACCESS_TOKEN')).toBe(false);
    await store.set('GOOGLE_ACCESS_TOKEN', 'ya29.token');
    expect([...rows.keys()]).toEqual([`${PACK_SECRET_KEY_PREFIX}GOOGLE_ACCESS_TOKEN`]);
    expect(await store.has('GOOGLE_ACCESS_TOKEN')).toBe(true);
    await store.clear('GOOGLE_ACCESS_TOKEN');
    expect(await store.has('GOOGLE_ACCESS_TOKEN')).toBe(false);
  });

  it('SEC-27 refuses instead of storing when encryption is unavailable', async () => {
    const { sink, rows } = fakeKeychain({ encryptionAvailable: false });
    const store = createKeychainSecretStore(sink);
    await expect(store.set('GOOGLE_ACCESS_TOKEN', 'ya29.token')).rejects.toThrow(
      /Secure secret storage is unavailable/
    );
    expect(rows.size).toBe(0);
  });

  it('lanes read what the settings page wrote, before the environment fallback', async () => {
    const { sink } = fakeKeychain();
    const resolver = createKeychainSecretResolver(
      sink,
      createEnvSecretResolver({ NINEBRAINS_SECRET_GOOGLE_ACCESS_TOKEN: 'from-env' })
    );
    expect(await resolver.resolve('GOOGLE_ACCESS_TOKEN')).toBe('from-env');
    await createKeychainSecretStore(sink).set('GOOGLE_ACCESS_TOKEN', 'from-keychain');
    expect(await resolver.resolve('GOOGLE_ACCESS_TOKEN')).toBe('from-keychain');
  });
});

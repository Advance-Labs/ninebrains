import { secret, type Secret } from '@emdash/shared';
import type { PackSecretStore, SecretResolver } from '@core/features/packs/node/secrets';

export const PACK_SECRET_KEY_PREFIX = 'ninebrains.pack.';

/** The slice of upstream's encrypted (safeStorage) app-secrets store the resolver reads. */
export interface KeychainSecretSource {
  getSecret(key: string): Promise<{ expose(): string } | null>;
}

/** The writable slice of the same store, for the settings page. */
export interface KeychainSecretSink extends KeychainSecretSource {
  setSecret(key: string, value: Secret<string>): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

/**
 * Pack secrets written from Settings → Packs into the OS keychain. The store throws when
 * safeStorage cannot encrypt (or Linux is on `basic_text`), so a value is never written in
 * plaintext (SEC-27). The value travels wrapped in `Secret` until the encrypt call.
 */
export function createKeychainSecretStore(sink: KeychainSecretSink): PackSecretStore {
  const key = (name: string) => `${PACK_SECRET_KEY_PREFIX}${name}`;
  return {
    async has(name) {
      try {
        return Boolean((await sink.getSecret(key(name)))?.expose().trim());
      } catch {
        return false;
      }
    },
    set: (name, value) => sink.setSecret(key(name), secret(value, key(name))),
    clear: (name) => sink.deleteSecret(key(name)),
  };
}

/**
 * Pack secrets from the OS keychain (Electron safeStorage via upstream's
 * EncryptedAppSecretsStore). The store refuses when encryption is unavailable
 * or Linux is on `basic_text`, so nothing is ever read from or written to
 * plaintext storage (SEC-27). A secret the keychain does not hold falls back
 * to `fallback`, the read-only environment resolver.
 */
export function createKeychainSecretResolver(
  source: KeychainSecretSource,
  fallback: SecretResolver
): SecretResolver {
  return {
    async resolve(name) {
      try {
        const value = (await source.getSecret(`${PACK_SECRET_KEY_PREFIX}${name}`))?.expose();
        if (value?.trim()) return value;
      } catch {
        // Keychain unavailable: behave as "not set" and let the fallback answer.
      }
      return fallback.resolve(name);
    },
    describeLocation: (name) =>
      `the app keychain (${PACK_SECRET_KEY_PREFIX}${name}) or ${fallback.describeLocation(name)}`,
  };
}

import type { SecretResolver } from '@core/features/packs/node/secrets';

export const PACK_SECRET_KEY_PREFIX = 'ninebrains.pack.';

/** The slice of upstream's encrypted (safeStorage) app-secrets store the resolver reads. */
export interface KeychainSecretSource {
  getSecret(key: string): Promise<{ expose(): string } | null>;
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

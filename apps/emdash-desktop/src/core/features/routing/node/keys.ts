import { secret, type Secret } from '@emdash/shared';
import { registerRedactionSecret } from '@core/features/exec-runs/api/node/redact';
import { PROFILE_ID, profileKeySchema } from '../api/profile';

/**
 * SEC-40: model-profile keys live only in safeStorage, as `ninebrains.model.<id>`, through
 * upstream's `EncryptedAppSecretsStore` (injected from main: core may not import Electron). The
 * store refuses when encryption is unavailable or Linux is on `basic_text`, so a key is never
 * written in plaintext (SEC-27). A key is decrypted only by `reveal`, which the launch path calls
 * for one spawn and test-connection for one request, and every stored or revealed value is
 * registered with the redactor (SEC-35).
 */
export const PROFILE_KEY_PREFIX = 'ninebrains.model.';

/** The slice of `EncryptedAppSecretsStore` this needs. */
export interface ProfileKeySink {
  getSecret(key: string): Promise<{ expose(): string } | null>;
  setSecret(key: string, value: Secret<string>): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface ProfileKeyStore {
  /** Stores or replaces the key. */
  set(profileId: string, value: string): Promise<void>;
  /** Main-process only, for one launch or one connection test. Never crosses the wire. */
  reveal(profileId: string): Promise<string | undefined>;
  clear(profileId: string): Promise<void>;
}

export function profileKeyName(profileId: string): string {
  if (!PROFILE_ID.test(profileId)) throw new Error('Unsafe profile id');
  return `${PROFILE_KEY_PREFIX}${profileId}`;
}

export function createProfileKeyStore(sink: ProfileKeySink): ProfileKeyStore {
  return {
    async set(profileId, value) {
      const key = profileKeySchema.parse(value);
      const name = profileKeyName(profileId);
      registerRedactionSecret(key);
      await sink.setSecret(name, secret(key, name));
    },
    async reveal(profileId) {
      const value = (await sink.getSecret(profileKeyName(profileId)))?.expose().trim();
      if (!value) return undefined;
      registerRedactionSecret(value);
      return value;
    },
    async clear(profileId) {
      await sink.deleteSecret(profileKeyName(profileId));
    },
  };
}

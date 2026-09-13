import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appSecrets } from '@core/services/app-db/node/schema';
import { createDrizzleClient } from '@main/db/drizzleClient';
import { initializeDatabase } from '@main/db/initialize';
import { EncryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { createKeychainSecretStore, PACK_SECRET_KEY_PREFIX } from './keychain-secret-resolver';

// SEC-27: a pack secret set from Settings → Packs reaches disk only as ciphertext. This drives
// the real store and a real app database file; only Electron's safeStorage is a stand-in.

const VALUE = 'sk-ant-api03-SEC27-PLAINTEXT-MARKER';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-sec27-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Reversible, and its output never contains the plaintext bytes. */
function fakeSafeStorage(backend: string) {
  const flip = (bytes: Buffer) => Buffer.from(bytes.map((b) => b ^ 0x5a));
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => flip(Buffer.from(value, 'utf8')),
    decryptString: (bytes: Buffer) => flip(bytes).toString('utf8'),
  } as unknown as ConstructorParameters<typeof EncryptedAppSecretsStore>[1];
}

/** Every file under `dir` whose bytes contain one of `needles`. */
function filesContaining(dir: string, needles: string[]): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => {
      const bytes = readFileSync(file);
      return needles.some((needle) => bytes.includes(Buffer.from(needle, 'utf8')));
    });
}

async function openUserData(name: string) {
  const userData = join(root, name);
  mkdirSync(userData, { recursive: true });
  const client = createDrizzleClient({ filePath: join(userData, 'emdash4.db') });
  await initializeDatabase(client.sqlite);
  return { userData, client };
}

describe('SEC-27 no plaintext secrets', () => {
  it('stores only ciphertext in the settings DB, and nothing under userData holds the value', async () => {
    const { userData, client } = await openUserData('keychain');
    try {
      const store = createKeychainSecretStore(
        new EncryptedAppSecretsStore(client.db, fakeSafeStorage('keychain'), 'darwin')
      );
      await store.set('ALPHA_KEY', VALUE);
      expect(await store.has('ALPHA_KEY')).toBe(true);
      const rows = client.db.select().from(appSecrets).all();
      expect(rows.map((row) => row.key)).toEqual([`${PACK_SECRET_KEY_PREFIX}ALPHA_KEY`]);
      client.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      const base64 = Buffer.from(VALUE, 'utf8').toString('base64');
      expect(filesContaining(userData, [VALUE, base64])).toEqual([]);
    } finally {
      client.close();
    }
  });

  it('refuses to store anything when Linux safeStorage is basic_text', async () => {
    const { userData, client } = await openUserData('basic-text');
    try {
      const store = createKeychainSecretStore(
        new EncryptedAppSecretsStore(client.db, fakeSafeStorage('basic_text'), 'linux')
      );
      await expect(store.set('ALPHA_KEY', VALUE)).rejects.toThrow(/basic_text/);
      expect(client.db.select().from(appSecrets).all()).toEqual([]);
      client.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      expect(filesContaining(userData, [VALUE])).toEqual([]);
    } finally {
      client.close();
    }
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  betterSqlite3Driver,
  defineDurableSqliteStore,
} from '@emdash/core/primitives/sqlite-store/node';
import { BRAIN_BUNDLED_MIGRATIONS, type SqliteConnectionLike } from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelProfileInput } from '../api/profile';
import { createProfileKeyStore, type ProfileKeySink } from './keys';
import { createProfilesRepo } from './profiles-repo';
import { createRoutingService } from './routing-service';
import type { ConnectionTester } from './test-connection';

/**
 * Opens the same Brain DB (brain-core's migrations, the durable sqlite store) that
 * `core/features/brain/node/brain-db.ts` opens in main, without importing it: a routing
 * node test importing another feature's node surface would break the module-boundary lint
 * (features -> features is only allowed via api/contributions). The migrations themselves
 * are the shared source of truth (`@ninebrains/brain-core`), so this stays a real integration
 * test of `model_profiles`, not a hand-rolled schema.
 */
const testBrainStore = defineDurableSqliteStore({
  name: 'brain-test',
  driver: betterSqlite3Driver,
  migrations: BRAIN_BUNDLED_MIGRATIONS,
});

function openTestBrainStore(path: string): { connection: SqliteConnectionLike; close(): void } {
  const handle = testBrainStore.open(path);
  return {
    connection: handle.connection as unknown as SqliteConnectionLike,
    close: () => handle.close(),
  };
}

function fakeSink(): ProfileKeySink & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getSecret: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : { expose: () => value };
    }),
    setSecret: vi.fn(async (key: string, value: { expose(): string }) => {
      store.set(key, value.expose());
    }),
    deleteSecret: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const NOOP_TESTER: ConnectionTester = async () => ({
  status: 'ok',
  httpStatus: 200,
  message: 'Connected.',
  modelCount: 0,
});

const KEY = 'sk-ant-donotleakthisvalueeither999888';

const FULL_INPUT: ModelProfileInput = {
  label: 'Round trip',
  kind: 'anthropic-compatible',
  vendorId: 'openrouter',
  baseUrl: 'https://openrouter.ai/api',
  model: 'anthropic/claude-sonnet-5',
  tierModels: { opus: 'anthropic/claude-opus-4', haiku: 'anthropic/claude-haiku-4' },
  tier: 'strong',
  price: { inPerMTok: 3, outPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  contextWindow: 200_000,
  enabled: true,
};

describe('SEC-40 no key bytes in the Brain DB', () => {
  let dir: string;
  let path: string;
  let opened: ReturnType<typeof openTestBrainStore>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nb-routing-db-'));
    path = join(dir, 'b.db');
    opened = openTestBrainStore(path);
  });

  afterEach(() => {
    opened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never writes the key to the database file, or its WAL sibling', async () => {
    const service = createRoutingService({
      enabled: () => true,
      profiles: createProfilesRepo(opened.connection),
      keys: createProfileKeyStore(fakeSink()),
      testConnection: NOOP_TESTER,
      onError: () => {},
      resolveInstalled: async () => ({ installed: false, path: null }),
      reviewerProfileId: async () => null,
    });
    const saved = await service.saveProfile(FULL_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    opened.close();

    const bytes = readFileSync(path, 'latin1');
    expect(bytes).not.toContain(KEY);
    const walPath = `${path}-wal`;
    if (existsSync(walPath)) {
      expect(readFileSync(walPath, 'latin1')).not.toContain(KEY);
    }

    // Reopen so afterEach's close() is safe.
    opened = openTestBrainStore(path);
  });

  it('round-trips every field through the repo', async () => {
    const repo = createProfilesRepo(opened.connection);
    const service = createRoutingService({
      enabled: () => true,
      profiles: repo,
      keys: createProfileKeyStore(fakeSink()),
      testConnection: NOOP_TESTER,
      onError: () => {},
      resolveInstalled: async () => ({ installed: false, path: null }),
      reviewerProfileId: async () => null,
    });
    const saved = await service.saveProfile(FULL_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);

    const stored = repo.get(saved.data.profileId);
    expect(stored).toMatchObject({
      price: FULL_INPUT.price,
      tierModels: FULL_INPUT.tierModels,
      tier: 'strong',
      contextWindow: 200_000,
      enabled: true,
      hasKey: true,
    });
  });

  it('skips a row whose base_url was hand-edited off the vendor allowlist', async () => {
    const repo = createProfilesRepo(opened.connection);
    const service = createRoutingService({
      enabled: () => true,
      profiles: repo,
      keys: createProfileKeyStore(fakeSink()),
      testConnection: NOOP_TESTER,
      onError: () => {},
      resolveInstalled: async () => ({ installed: false, path: null }),
      reviewerProfileId: async () => null,
    });
    const saved = await service.saveProfile(FULL_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    opened.connection.run('UPDATE model_profiles SET base_url = ? WHERE id = ?', [
      'https://evil.test/api',
      saved.data.profileId,
    ]);

    expect(repo.get(saved.data.profileId)).toBeUndefined();
    expect(repo.list().some((p) => p.id === saved.data.profileId)).toBe(false);
  });
});

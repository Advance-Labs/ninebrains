import { describe, expect, it, vi } from 'vitest';
import { USER_PACKS_ENABLED } from '@core/primitives/app-identity/api/fork-flags';
import type { PackFs } from './loader';
import { createPacksService } from './packs-service';
import { createMemoryPackPrefsStore } from './prefs-store';
import { manifest, secretsFrom } from './test-fixtures';

function userPackFs(): PackFs & { listDirs: ReturnType<typeof vi.fn> } {
  return {
    listDirs: vi.fn(async () => ['gamma']),
    readInside: async (_root, relativePath) => {
      if (relativePath === 'pack.json') return JSON.stringify(manifest({ id: 'gamma' }));
      throw new Error(`unexpected read ${relativePath}`);
    },
  };
}

const service = (fs: PackFs, allowUserPacks?: boolean) =>
  createPacksService({
    prefs: createMemoryPackPrefsStore(),
    secrets: secretsFrom({}),
    bundled: [{ id: 'alpha', json: manifest({ id: 'alpha' }), files: {} }],
    userPacksDir: '/user-data/ninebrains/packs',
    fs,
    ...(allowUserPacks === undefined ? {} : { allowUserPacks }),
  });

describe('SEC-26 pack pinning: bundled packs only in v0.1', () => {
  it('keeps the user-pack fork flag off', () => {
    expect(USER_PACKS_ENABLED).toBe(false);
  });

  it('never reads the user-pack directory while the flag is off', async () => {
    const fs = userPackFs();
    const loaded = await service(fs).reload();
    expect(loaded.packs.map((pack) => pack.manifest.id)).toEqual(['alpha']);
    expect(fs.listDirs).not.toHaveBeenCalled();
  });

  it('loads a user pack only when explicitly allowed', async () => {
    const loaded = await service(userPackFs(), true).reload();
    expect(loaded.packs.map((pack) => pack.manifest.id)).toEqual(['alpha', 'gamma']);
  });
});

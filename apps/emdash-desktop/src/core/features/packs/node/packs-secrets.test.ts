import { describe, expect, it, vi } from 'vitest';
import type { BundledPack } from './bundled';
import { createPacksService } from './packs-service';
import { createMemoryPackPrefsStore } from './prefs-store';
import type { PackSecretStore, SecretResolver } from './secrets';
import { manifest } from './test-fixtures';

// Settings → Packs secrets are write-only (SEC-27, SEC-35 spirit): main stores a value it is
// given and afterwards only ever answers "set" or "missing".

const VALUE = 'sk-ant-api03-THIS-IS-THE-SECRET-VALUE';

const bundled: BundledPack[] = [
  {
    id: 'alpha',
    json: manifest({
      id: 'alpha',
      requiredSecrets: [
        { name: 'ALPHA_KEY', description: 'Alpha key.', howToGet: 'Ask alpha.', optional: false },
      ],
    }),
    files: {},
  },
];

/** A keychain stand-in that a resolver reads from, as the app wires them. */
function keychain(options: { failWith?: Error } = {}) {
  const rows = new Map<string, string>();
  const store: PackSecretStore & { set: ReturnType<typeof vi.fn> } = {
    has: async (name) => rows.has(name),
    set: vi.fn(async (name: string, value: string) => {
      if (options.failWith) throw options.failWith;
      rows.set(name, value);
    }),
    clear: async (name) => void rows.delete(name),
  };
  const resolver: SecretResolver = {
    resolve: async (name) => rows.get(name),
    describeLocation: (name) => `the app keychain (ninebrains.pack.${name})`,
  };
  return { rows, store, resolver };
}

function service(options: { failWith?: Error; noStore?: boolean } = {}) {
  const k = keychain(options);
  const warnings: string[] = [];
  const packs = createPacksService({
    prefs: createMemoryPackPrefsStore(),
    secrets: k.resolver,
    ...(options.noStore ? {} : { secretStore: k.store }),
    bundled,
    onWarning: (message) => warnings.push(message),
  });
  return { packs, warnings, ...k };
}

describe('pack secrets from the settings page', () => {
  it('stores a declared secret and then reports only that it is set', async () => {
    const { packs, rows } = service();
    expect((await packs.list(null)).packs[0]!.secrets[0]).toMatchObject({
      present: false,
      storedInApp: false,
    });

    expect(await packs.setSecret('ALPHA_KEY', `  ${VALUE}\n`)).toEqual({
      success: true,
      data: undefined,
    });
    expect(rows.get('ALPHA_KEY')).toBe(VALUE);

    const listing = await packs.list('p1');
    expect(listing.packs[0]!.secrets[0]).toMatchObject({ present: true, storedInApp: true });
    // Nothing the renderer can read carries the value.
    expect(JSON.stringify(listing)).not.toContain(VALUE);

    expect(await packs.clearSecret('ALPHA_KEY')).toEqual({ success: true, data: undefined });
    expect((await packs.list(null)).packs[0]!.secrets[0]).toMatchObject({
      present: false,
      storedInApp: false,
    });
  });

  it('refuses a name no loaded pack declares, without touching the store', async () => {
    const { packs, store } = service();
    const result = await packs.setSecret('GITHUB_TOKEN', VALUE);
    expect(result).toMatchObject({ success: false, error: { type: 'unknown-secret' } });
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect(store.set).not.toHaveBeenCalled();
    expect(await packs.clearSecret('GITHUB_TOKEN')).toMatchObject({ success: false });
  });

  it('refuses an empty value', async () => {
    const { packs, store } = service();
    expect(await packs.setSecret('ALPHA_KEY', '   ')).toMatchObject({ success: false });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('SEC-27 surfaces a keychain refusal without the value in the error or the log', async () => {
    const { packs, warnings, rows } = service({
      failWith: new Error('Secure secret storage is unavailable on this system.'),
    });
    const result = await packs.setSecret('ALPHA_KEY', VALUE);
    expect(result).toMatchObject({
      success: false,
      error: { type: 'secret-store', message: expect.stringContaining('unavailable') },
    });
    expect(rows.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect(warnings.join('\n')).not.toContain(VALUE);
  });

  it('never echoes a thrown non-Error (it could be the value itself)', async () => {
    const { packs, warnings, store } = service();
    store.set.mockRejectedValueOnce(VALUE);
    const result = await packs.setSecret('ALPHA_KEY', VALUE);
    expect(result).toMatchObject({ success: false, error: { type: 'secret-store' } });
    expect(JSON.stringify(result)).not.toContain(VALUE);
    expect(warnings.join('\n')).not.toContain(VALUE);
  });

  it('refuses to write when no secret store is configured', async () => {
    const { packs } = service({ noStore: true });
    expect(await packs.setSecret('ALPHA_KEY', VALUE)).toMatchObject({
      success: false,
      error: { type: 'secret-store' },
    });
  });
});

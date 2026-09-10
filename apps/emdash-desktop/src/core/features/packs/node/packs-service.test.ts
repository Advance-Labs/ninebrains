import { describe, expect, it } from 'vitest';
import type { BundledPack } from './bundled';
import { createPacksService } from './packs-service';
import {
  createMemoryPackPrefsStore,
  createMementoPackPrefsStore,
  type PackPrefsMementoClient,
} from './prefs-store';
import type { SkillsPort } from './skills-sync';
import { manifest, secretsFrom, SKILL_MD } from './test-fixtures';

const skill = { id: 'audit', path: 'skills/audit/SKILL.md', license: 'MIT' as const, source: 'x' };
const bundled: BundledPack[] = [
  {
    id: 'alpha',
    json: manifest({
      id: 'alpha',
      skills: [skill],
      requiredSecrets: [
        { name: 'ALPHA_KEY', description: 'Alpha key.', howToGet: 'Ask alpha.', optional: false },
      ],
    }),
    files: { 'skills/audit/SKILL.md': SKILL_MD },
  },
  { id: 'beta', json: manifest({ id: 'beta' }), files: {} },
];

function skillsPort(): SkillsPort & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    listInstalled: async () => [...store].map(([id, skillMdContent]) => ({ id, skillMdContent })),
    install: async ({ id, content }) => void store.set(id, content),
    remove: async (id) => void store.delete(id),
  };
}

function service(skills = skillsPort()) {
  const prefs = createMemoryPackPrefsStore();
  const packs = createPacksService({ prefs, secrets: secretsFrom({}), skills, bundled });
  return { packs, prefs, skills };
}

describe('createPacksService', () => {
  it('lists packs with per-project state and missing secrets', async () => {
    const { packs } = service();
    await packs.setEnabled('p1', 'alpha', true);
    const listing = await packs.list('p1');
    expect(listing.errors).toEqual([]);
    expect(listing.packs.map((p) => [p.id, p.enabled])).toEqual([
      ['alpha', true],
      ['beta', false],
    ]);
    expect(listing.packs[0].secrets).toEqual([
      expect.objectContaining({
        name: 'ALPHA_KEY',
        present: false,
        location: 'test store entry ALPHA_KEY',
      }),
    ]);
    expect(listing.packs[0].skills).toEqual([
      { id: 'audit', installId: 'nb-alpha-audit', source: 'x' },
    ]);
    expect((await packs.list(null)).packs.every((p) => !p.enabled)).toBe(true);
  });

  it('refuses to toggle a pack that is not loaded', async () => {
    const { packs } = service();
    const result = await packs.setEnabled('p1', 'nope', true);
    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ type: 'unknown-pack' }),
    });
  });

  it('installs skills on first enable and uninstalls only when disabled everywhere', async () => {
    const { packs, skills } = service();
    await packs.setEnabled('p1', 'alpha', true);
    await packs.setEnabled('p2', 'alpha', true);
    expect([...skills.store.keys()]).toEqual(['nb-alpha-audit']);

    await packs.setEnabled('p1', 'alpha', false);
    expect([...skills.store.keys()]).toEqual(['nb-alpha-audit']);

    await packs.setEnabled('p2', 'alpha', false);
    expect([...skills.store.keys()]).toEqual([]);
  });

  it('resolves a lane launch from the project prefs', async () => {
    const { packs } = service();
    await packs.setEnabled('p1', 'beta', true);
    const launch = await packs.resolvePackLaunch('p1', 'worker');
    expect(launch.role).toEqual({ packId: 'beta', roleId: 'worker', kind: 'code' });
    expect(launch.defaultGates).toEqual(['tests']);
    expect((await packs.resolvePackLaunch('p2')).defaultGates).toEqual([]);
  });

  it('exposes the seo-evidence gate', () => {
    expect(
      service()
        .packs.createGates()
        .map((g) => g.id)
    ).toEqual(['seo-evidence']);
  });
});

describe('createMementoPackPrefsStore', () => {
  function fakeClient() {
    const rows = new Map<string, { version: string; data: string; updatedAt: number }>();
    const k = (key: { mementoId: string; kind: string; key: string }) =>
      `${key.mementoId}|${key.kind}|${key.key}`;
    const client = {
      memento: {
        state: (key: { mementoId: string; kind: string; key: string }) => ({
          snapshot: async () => ({
            generation: 0,
            sequence: 0,
            timestamp: 0,
            data: rows.get(k(key)) ?? null,
          }),
        }),
        mutate: async (
          _name: string,
          envelope: {
            key: { mementoId: string; kind: string; key: string };
            input: { version: string; data: string; updatedAt: number };
          }
        ) => {
          rows.set(k(envelope.key), envelope.input);
          return { success: true };
        },
      },
    };
    return { client: client as unknown as PackPrefsMementoClient, rows };
  }

  it('round-trips per-project toggles and keeps an index of projects', async () => {
    const { client, rows } = fakeClient();
    const store = createMementoPackPrefsStore(
      async () => client,
      () => 42
    );
    expect(await store.getEnabled('p1')).toEqual([]);

    await store.setEnabled('p1', ['seo', 'seo', 'coding']);
    await store.setEnabled('p2', ['research']);
    await store.setEnabled('p1', ['seo']);

    expect(await store.getEnabled('p1')).toEqual(['seo']);
    expect(await store.listProjects()).toEqual(['p1', 'p2']);
    expect(rows.get('packs.project-prefs|project|p1')).toEqual({
      version: '1',
      data: JSON.stringify({ version: '1', enabledPackIds: ['seo'] }),
      updatedAt: 42,
    });
    expect(rows.has('packs.prefs-index|app|')).toBe(true);
  });

  it('surfaces a persistence failure', async () => {
    const { client } = fakeClient();
    (client.memento as unknown as { mutate: unknown }).mutate = async () => ({
      success: false,
      error: { code: 'persistence', message: 'disk full' },
    });
    const store = createMementoPackPrefsStore(async () => client);
    await expect(store.setEnabled('p1', ['seo'])).rejects.toThrow('disk full');
  });
});

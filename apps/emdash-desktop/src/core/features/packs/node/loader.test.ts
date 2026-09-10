import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BundledPack } from './bundled';
import { KNOWN_GATE_IDS } from './gate-ids';
import { loadPacks, nodePackFs, type PackFs } from './loader';
import { manifest, SKILL_MD } from './test-fixtures';

function memoryFs(dirs: Record<string, Record<string, string>>): PackFs {
  return {
    listDirs: async () => Object.keys(dirs),
    readInside: async (root, rel) => {
      const content = dirs[path.basename(root)]?.[rel];
      if (content === undefined) throw new Error(`ENOENT: ${rel}`);
      return content;
    },
  };
}

const bundle = (id: string, json: unknown, files: Record<string, string> = {}): BundledPack => ({
  id,
  json,
  files,
});

describe('loadPacks', () => {
  it('isolates a broken bundled pack from the others', async () => {
    const result = await loadPacks({
      bundled: [
        bundle('good', manifest({ id: 'good' })),
        bundle('bad', { id: 'bad', title: 'missing everything' }),
        bundle('also-good', manifest({ id: 'also-good' })),
      ],
      knownGateIds: KNOWN_GATE_IDS,
    });
    expect(result.packs.map((p) => p.manifest.id)).toEqual(['good', 'also-good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      source: 'bundled',
      packId: 'bad',
      location: 'bundled:bad',
    });
  });

  it('rejects unknown gate ids and missing bundled skills', async () => {
    const skill = {
      id: 'demo',
      path: 'skills/demo/SKILL.md',
      license: 'MIT' as const,
      source: 'x',
    };
    const result = await loadPacks({
      bundled: [
        bundle('gated', manifest({ id: 'gated', gates: ['vibes-check'] })),
        bundle('skilled', manifest({ id: 'skilled', skills: [skill] })),
      ],
      knownGateIds: KNOWN_GATE_IDS,
    });
    expect(result.packs).toEqual([]);
    expect(result.errors.map((e) => e.message).join('\n')).toMatch(
      /unknown gate id\(s\): vibes-check/
    );
    expect(result.errors.map((e) => e.message).join('\n')).toMatch(/is not bundled/);
  });

  it('loads user packs and reports each bad one separately', async () => {
    const skill = {
      id: 'demo',
      path: 'skills/demo/SKILL.md',
      license: 'MIT' as const,
      source: 'x',
    };
    const fs = memoryFs({
      mine: {
        'pack.json': JSON.stringify(manifest({ id: 'mine', skills: [skill] })),
        'skills/demo/SKILL.md': SKILL_MD,
      },
      broken: { 'pack.json': '{ not json' },
      renamed: { 'pack.json': JSON.stringify(manifest({ id: 'other-name' })) },
      shadow: { 'pack.json': JSON.stringify(manifest({ id: 'shadow' })) },
      nofront: {
        'pack.json': JSON.stringify(manifest({ id: 'nofront', skills: [skill] })),
        'skills/demo/SKILL.md': '# no frontmatter',
      },
    });
    const result = await loadPacks({
      bundled: [bundle('shadow', manifest({ id: 'shadow' }))],
      userPacksDir: '/user/packs',
      fs,
      knownGateIds: KNOWN_GATE_IDS,
    });
    expect(result.packs.map((p) => `${p.source}:${p.manifest.id}`)).toEqual([
      'bundled:shadow',
      'user:mine',
    ]);
    expect(result.packs[1].skills.demo).toBe(SKILL_MD);
    const byPack = Object.fromEntries(result.errors.map((e) => [e.packId, e.message]));
    expect(Object.keys(byPack).sort()).toEqual(['broken', 'nofront', 'other-name', 'shadow']);
    expect(byPack['other-name']).toMatch(/must match its directory name "renamed"/);
    expect(byPack.shadow).toMatch(/already loaded/);
    expect(byPack.nofront).toMatch(/no frontmatter/);
  });

  it('treats a missing user packs directory as empty', async () => {
    const result = await loadPacks({
      bundled: [],
      userPacksDir: path.join(tmpdir(), 'ninebrains-packs-does-not-exist'),
      knownGateIds: KNOWN_GATE_IDS,
    });
    expect(result).toEqual({ packs: [], errors: [] });
  });
});

describe('nodePackFs', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('refuses a file that resolves outside the pack directory', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nb-packs-'));
    const root = path.join(dir, 'packs', 'sneaky');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(dir, 'secret.txt'), 'top secret');
    await symlink(path.join(dir, 'secret.txt'), path.join(root, 'pack.json'));
    await expect(nodePackFs.readInside(root, 'pack.json', 1024)).rejects.toThrow(/outside/);
  });

  it('refuses an oversized file', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nb-packs-'));
    await writeFile(path.join(dir, 'pack.json'), 'x'.repeat(100));
    await expect(nodePackFs.readInside(dir, 'pack.json', 10)).rejects.toThrow(/larger than/);
    await expect(nodePackFs.readInside(dir, 'pack.json', 1000)).resolves.toHaveLength(100);
  });
});

import { GATE_IDS } from '@emdash/gates-core';
import { describe, expect, it } from 'vitest';
import { PACK_LICENCE_ALLOWLIST } from '../api/pack-schema';
import { bundledPacks } from './bundled';
import { KNOWN_GATE_IDS } from './gate-ids';
import { loadPacks } from './loader';
import { createPacksService } from './packs-service';
import { createMemoryPackPrefsStore } from './prefs-store';
import { unconfiguredSecretResolver } from './secrets';
import { packSkillInstallId } from './skills-sync';

async function loadBundled() {
  return loadPacks({ bundled: bundledPacks, knownGateIds: KNOWN_GATE_IDS });
}

describe('bundled packs', () => {
  it('all validate', async () => {
    const { packs, errors } = await loadBundled();
    expect(errors).toEqual([]);
    expect(packs.map((p) => p.manifest.id)).toEqual(['coding', 'research', 'seo']);
  });

  it('reference only gate ids that have an implementation', async () => {
    const { packs } = await loadBundled();
    const service = createPacksService({
      prefs: createMemoryPackPrefsStore(),
      secrets: unconfiguredSecretResolver,
    });
    const implemented = new Set<string>([
      ...Object.values(GATE_IDS),
      ...service.createGates().map((g) => g.id),
    ]);
    for (const { manifest } of packs) {
      for (const id of [...manifest.gates, ...manifest.roles.flatMap((r) => r.gates)]) {
        expect(implemented.has(id), `${manifest.id} references gate "${id}"`).toBe(true);
      }
    }
  });

  it('keep every server and skill on the licence allowlist', async () => {
    const allowed = new Set<string>(PACK_LICENCE_ALLOWLIST);
    const { packs } = await loadBundled();
    for (const { manifest } of packs) {
      expect(allowed.has(manifest.license)).toBe(true);
      for (const item of [...manifest.mcpServers, ...manifest.skills]) {
        expect(allowed.has(item.license), `${manifest.id}: ${JSON.stringify(item)}`).toBe(true);
      }
    }
  });

  it('never carry a literal credential: every env and header value is a secret reference', async () => {
    const { packs } = await loadBundled();
    for (const { manifest } of packs) {
      for (const server of manifest.mcpServers) {
        const values =
          server.transport === 'http' ? Object.values(server.headers) : Object.values(server.env);
        for (const value of values) {
          expect(typeof value, `${manifest.id}/${server.name}`).toBe('object');
        }
      }
    }
  });

  it('ship the roles each discipline needs', async () => {
    const { packs } = await loadBundled();
    const roles = Object.fromEntries(
      packs.map((p) => [p.manifest.id, p.manifest.roles.map((r) => r.id)])
    );
    expect(roles.coding).toEqual(['builder', 'ui-builder', 'reviewer']);
    expect(roles.research).toEqual(['research-lead', 'researcher', 'fact-checker']);
    expect(roles.seo).toEqual([
      'seo-lead',
      'technical-seo',
      'content-strategist',
      'link-researcher',
      'search-analyst',
      'fact-checker',
    ]);
    const uiBuilder = packs[0].manifest.roles.find((r) => r.id === 'ui-builder');
    expect(uiBuilder?.gates).toContain('screenshot');
  });

  it('bundle the aeo-toolkit skills with attribution and valid install ids', async () => {
    const { packs } = await loadBundled();
    const seo = packs.find((p) => p.manifest.id === 'seo');
    expect(seo?.manifest.skills.map((s) => s.id)).toEqual([
      'seo-cannibalization',
      'seo-content-decay',
      'seo-traffic-drop',
    ]);
    for (const skill of seo?.manifest.skills ?? []) {
      expect(packSkillInstallId('seo', skill.id)).toBe(`nb-seo-${skill.id}`);
      expect(seo?.skills[skill.id]).toMatch(
        /Bundled from Advance-Labs\/aeo-toolkit .*Apache License 2\.0/
      );
    }
  });

  it('point the SEO pack at the three aeo-toolkit servers', async () => {
    const { packs } = await loadBundled();
    const servers = packs.find((p) => p.manifest.id === 'seo')?.manifest.mcpServers ?? [];
    expect(servers.map((s) => `${s.name}:${s.optional}`)).toEqual([
      'aeo-search:false',
      'aeo-visibility:false',
      'aeo-backlink:false',
      'dataforseo:true',
    ]);
  });
});

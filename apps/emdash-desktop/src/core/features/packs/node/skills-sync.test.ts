import { describe, expect, it } from 'vitest';
import {
  desiredPackSkills,
  packSkillInstallId,
  syncPackSkills,
  withSkillName,
  type SkillsPort,
} from './skills-sync';
import { loaded, manifest, SKILL_MD } from './test-fixtures';

function memorySkills(initial: Record<string, string> = {}): SkillsPort & {
  store: Map<string, string>;
  writes: number;
} {
  const store = new Map(Object.entries(initial));
  const port = {
    store,
    writes: 0,
    listInstalled: async () => [...store].map(([id, skillMdContent]) => ({ id, skillMdContent })),
    install: async ({ id, content }: { id: string; content: string }) => {
      port.writes += 1;
      store.set(id, content);
    },
    remove: async (id: string) => {
      port.writes += 1;
      store.delete(id);
    },
  };
  return port;
}

const skill = { id: 'audit', path: 'skills/audit/SKILL.md', license: 'MIT' as const, source: 'x' };
const seo = loaded(manifest({ id: 'seo', skills: [skill] }), { audit: SKILL_MD });

describe('pack skill naming', () => {
  it('prefixes install ids with nb-<pack>-', () => {
    expect(packSkillInstallId('seo', 'seo-traffic-drop')).toBe('nb-seo-seo-traffic-drop');
    expect(() => packSkillInstallId('seo', 'x'.repeat(80))).toThrow(/not a valid skill name/);
  });

  it('rewrites only the frontmatter name', () => {
    const renamed = withSkillName(SKILL_MD, 'nb-seo-audit');
    expect(renamed).toBe(SKILL_MD.replace('name: demo', 'name: nb-seo-audit'));
    expect(() => withSkillName('# nothing', 'x')).toThrow(/frontmatter/);
  });
});

describe('syncPackSkills', () => {
  it('installs skills of enabled packs and is idempotent', async () => {
    const port = memorySkills({ 'user-skill': 'mine' });
    const desired = desiredPackSkills([seo], new Set(['seo']));

    const first = await syncPackSkills(port, desired);
    expect(first.installed).toEqual(['nb-seo-audit']);
    expect(port.store.get('nb-seo-audit')).toContain('name: nb-seo-audit');

    const writes = port.writes;
    const second = await syncPackSkills(port, desired);
    expect(second).toEqual({ installed: [], removed: [], unchanged: ['nb-seo-audit'], errors: [] });
    expect(port.writes).toBe(writes);
  });

  it('removes nb- skills once the pack is enabled nowhere, and leaves other skills alone', async () => {
    const port = memorySkills({
      'nb-seo-audit': 'old',
      'nb-gone-thing': 'old',
      'user-skill': 'mine',
    });
    const report = await syncPackSkills(port, desiredPackSkills([seo], new Set()));
    expect(report.removed.sort()).toEqual(['nb-gone-thing', 'nb-seo-audit']);
    expect([...port.store.keys()]).toEqual(['user-skill']);
  });

  it('reports a failed install without stopping the rest', async () => {
    const port = memorySkills();
    port.install = async () => {
      throw new Error('disk full');
    };
    const report = await syncPackSkills(port, desiredPackSkills([seo], new Set(['seo'])));
    expect(report.errors).toEqual(['install nb-seo-audit: Error: disk full']);
  });
});

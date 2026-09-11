import type { Evidence, GateContext } from '@emdash/gates-core';
import { describe, expect, it, vi } from 'vitest';
import { packSchema, type PackMcpServer } from '../api/pack-schema';
import { createPacksService } from './packs-service';
import { createMemoryPackPrefsStore } from './prefs-store';
import { resolvePackLaunch } from './resolve-launch';
import { loaded, manifest, secretsFrom } from './test-fixtures';

const DEFAULT_BASE = 'https://aeo.advancelabs.dev/api/mcp';

const hosted: PackMcpServer = {
  name: 'aeo-search',
  description: 'Search data.',
  transport: 'http',
  url: '{{AEO_MCP_BASE_URL}}/search/mcp',
  headers: {},
  optional: false,
  homepage: 'https://github.com/Advance-Labs/aeo-toolkit',
  license: 'Apache-2.0',
};
const setting = {
  name: 'AEO_MCP_BASE_URL',
  description: 'Base URL.',
  default: DEFAULT_BASE,
  defaultDisclosure: 'Your token goes to the hosted endpoint.',
};
const pack = loaded(manifest({ id: 'seo', mcpServers: [hosted], settings: [setting] }));

async function launchWith(values: Record<string, string>) {
  return resolvePackLaunch({
    packs: [pack],
    enabledPackIds: ['seo'],
    secrets: secretsFrom(values),
  });
}

describe('AEO_MCP_BASE_URL', () => {
  it('validates url placeholders against declared settings', () => {
    expect(packSchema.safeParse(pack.manifest).success).toBe(true);
    const undeclared = packSchema.safeParse(manifest({ mcpServers: [hosted] }));
    expect(undeclared.success).toBe(false);
    expect(JSON.stringify(undeclared.error?.issues)).toMatch(
      /AEO_MCP_BASE_URL, which settings does not declare/
    );
    const insecure = packSchema.safeParse(
      manifest({
        mcpServers: [hosted],
        settings: [{ ...setting, default: 'http://example.com/mcp' }],
      })
    );
    expect(insecure.success).toBe(false);
  });

  it('uses the hosted default unless it is overridden', async () => {
    expect((await launchWith({})).mcpServers[0]).toMatchObject({
      url: `${DEFAULT_BASE}/search/mcp`,
    });
    const own = await launchWith({ AEO_MCP_BASE_URL: 'https://seo.example.com/api/mcp/' });
    expect(own.mcpServers[0]).toMatchObject({ url: 'https://seo.example.com/api/mcp/search/mcp' });
    const local = await launchWith({ AEO_MCP_BASE_URL: 'http://localhost:3000/api/mcp' });
    expect(local.mcpServers[0]).toMatchObject({ url: 'http://localhost:3000/api/mcp/search/mcp' });
  });

  it('leaves the server out when the override is not https', async () => {
    for (const bad of ['http://evil.example.com/api/mcp', 'file:///etc', 'not a url']) {
      const launch = await launchWith({ AEO_MCP_BASE_URL: bad });
      expect(launch.mcpServers, bad).toEqual([]);
      expect(launch.warnings[0].message).toMatch(/not https.*check AEO_MCP_BASE_URL/);
    }
  });
});

describe('the bundled SEO pack', () => {
  const service = (values: Record<string, string> = {}) =>
    createPacksService({ prefs: createMemoryPackPrefsStore(), secrets: secretsFrom(values) });

  it('is off by default in every project, and launches nothing until enabled', async () => {
    const packs = service({ GOOGLE_ACCESS_TOKEN: 'g' });
    expect((await packs.list('p1')).packs.every((p) => !p.enabled)).toBe(true);
    const launch = await packs.resolvePackLaunch('p1', 'seo-lead');
    expect(launch.mcpServers).toEqual([]);
    expect(launch.appendSystemPrompt).toBeUndefined();
  });

  it('points at the hosted endpoint by default and discloses what it sends', async () => {
    const packs = service({ GOOGLE_ACCESS_TOKEN: 'g' });
    await packs.setEnabled('p1', 'seo', true);
    const urls = (await packs.resolvePackLaunch('p1')).mcpServers.map((s) =>
      s.type === 'http' ? s.url : s.name
    );
    expect(urls).toEqual([
      `${DEFAULT_BASE}/search/mcp`,
      `${DEFAULT_BASE}/ai-visibility/mcp`,
      `${DEFAULT_BASE}/backlink/mcp`,
    ]);

    const seo = (await packs.list('p1')).packs.find((p) => p.id === 'seo');
    expect(seo?.description).toMatch(
      /Off until you enable it.*Google access token.*Advance Labs' hosted endpoint/
    );
    expect(seo?.settings).toEqual([
      expect.objectContaining({ name: 'AEO_MCP_BASE_URL', overridden: false }),
    ]);
    expect(seo?.disclosures).toHaveLength(1);
    expect(seo?.disclosures[0]).toMatch(
      /Google access token.*Advance Labs' hosted endpoint.*self-host/
    );
    expect(seo?.disclosures[0]).toContain('github.com/Advance-Labs/aeo-toolkit');
  });

  it('drops the disclosure once self-hosted', async () => {
    const packs = service({ AEO_MCP_BASE_URL: 'https://seo.example.com/api/mcp' });
    const seo = (await packs.list('p1')).packs.find((p) => p.id === 'seo');
    expect(seo?.settings[0].overridden).toBe(true);
    expect(seo?.disclosures).toEqual([]);
  });

  it('gives the evidence reviewer no SEO servers while the pack is enabled nowhere', async () => {
    const packs = service({ GOOGLE_ACCESS_TOKEN: 'g' });
    const spawn = vi.fn(async () => ({
      text: JSON.stringify({ verdicts: [{ id: 'F1', status: 'confirmed', note: 'ok' }] }),
    }));
    const findings = {
      site: 'https://example.com/',
      findings: [
        {
          id: 'F1',
          title: 'Drop',
          recommendation: 'Fix.',
          evidence: [{ type: 'query', tool: 'gsc_top_queries', args: {}, observed: { clicks: 1 } }],
        },
      ],
    };
    const ctx: GateContext = {
      job: { id: 'j', title: 'Audit', body: 'b', kind: 'seo', attempt: 1 },
      worktreePath: '/work',
      signal: new AbortController().signal,
      evidence: {
        dir: '/mem',
        put: async (i) =>
          ({ kind: i.kind, label: i.label, path: `/mem/${i.fileName}` }) as Evidence,
        list: () => [],
      },
      capabilities: {
        captureScreenshot: vi.fn(),
        runCommand: vi.fn(),
        fetchText: vi.fn(),
        spawnReviewer: spawn,
        prepareReviewCheckout: async () => ({
          path: '/tmp/review',
          dispose: async () => undefined,
        }),
        readWorktreeFile: async () => JSON.stringify(findings),
      },
    };
    const [gate] = packs.createGates();

    const off = await gate.run(ctx);
    expect(off.feedback).toMatch(/cannot use: aeo-search/);
    expect(spawn).not.toHaveBeenCalled();

    await packs.setEnabled('p1', 'seo', true);
    const on = await gate.run(ctx);
    expect(on.pass).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

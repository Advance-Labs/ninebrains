import { describe, expect, it } from 'vitest';
import type { PackMcpServer } from '../api/pack-schema';
import { resolvePackLaunch } from './resolve-launch';
import { loaded, manifest, secretsFrom } from './test-fixtures';

const secret = (name: string, optional = false) => ({
  name,
  description: `${name}.`,
  howToGet: 'Somewhere.',
  optional,
});

const search: PackMcpServer = {
  name: 'search',
  description: 'Search data.',
  transport: 'http',
  url: 'https://example.com/mcp',
  headers: {
    Authorization: { secret: 'GOOGLE_TOKEN', prefix: 'Bearer ' },
    'X-Bing-Api-Key': { secret: 'BING_KEY', optional: true },
  },
  optional: false,
  homepage: 'https://example.com',
  license: 'Apache-2.0',
};

const cli: PackMcpServer = {
  name: 'cli',
  description: 'A stdio server.',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'cli-mcp@1.0.0', 'run', { secret: 'ACCOUNT_ID' }],
  env: { API_TOKEN: { secret: 'API_TOKEN' }, MODE: 'read-only' },
  optional: true,
  homepage: 'https://example.com',
  license: 'MIT',
};

const seo = loaded(
  manifest({
    id: 'seo',
    roles: [
      {
        id: 'lead',
        title: 'Lead',
        kind: 'seo',
        systemPrompt: 'You are the lead lane. Plan the audit.',
        gates: ['seo-evidence', 'reviewer'],
      },
      {
        id: 'worker',
        title: 'Worker',
        kind: 'seo',
        systemPrompt: 'You are an SEO worker lane. Do the job.',
        gates: [],
      },
    ],
    mcpServers: [search, cli],
    gates: ['seo-evidence'],
    requiredSecrets: [
      secret('GOOGLE_TOKEN'),
      secret('BING_KEY', true),
      secret('ACCOUNT_ID', true),
      secret('API_TOKEN', true),
    ],
  })
);
const coding = loaded(manifest({ id: 'coding', gates: ['tests', 'reviewer'] }));

describe('resolvePackLaunch', () => {
  it('resolves every secret into the launch entries', async () => {
    const launch = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      secrets: secretsFrom({
        GOOGLE_TOKEN: 'g-1',
        BING_KEY: 'b-1',
        ACCOUNT_ID: 'acct',
        API_TOKEN: 't-1',
      }),
    });
    expect(launch.warnings).toEqual([]);
    expect(launch.mcpServers).toEqual([
      {
        name: 'search',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer g-1', 'X-Bing-Api-Key': 'b-1' },
      },
      {
        name: 'cli',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'cli-mcp@1.0.0', 'run', 'acct'],
        env: { API_TOKEN: 't-1', MODE: 'read-only' },
      },
    ]);
    expect(launch.defaultGates).toEqual(['seo-evidence']);
    expect(launch.appendSystemPrompt).toBeUndefined();
  });

  it('omits a server whose required secret is missing, and never leaks values', async () => {
    const launch = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      secrets: secretsFrom({ API_TOKEN: 'super-secret-value' }),
    });
    expect(launch.mcpServers).toEqual([]);
    expect(launch.warnings.map((w) => [w.server, w.missingSecrets])).toEqual([
      ['search', ['GOOGLE_TOKEN']],
      ['cli', ['ACCOUNT_ID']],
    ]);
    expect(launch.warnings[1].message).toMatch(/^optional server "cli" was left out/);
    expect(JSON.stringify(launch.warnings)).not.toContain('super-secret-value');
  });

  it('drops only the header for a missing optional secret', async () => {
    const launch = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      secrets: secretsFrom({ GOOGLE_TOKEN: 'g-1' }),
    });
    expect(launch.mcpServers[0]).toMatchObject({
      name: 'search',
      headers: { Authorization: 'Bearer g-1' },
    });
    expect(Object.keys((launch.mcpServers[0] as { headers: object }).headers)).toEqual([
      'Authorization',
    ]);
  });

  it('treats a resolver failure as a missing secret', async () => {
    const launch = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      secrets: {
        resolve: async () => {
          throw new Error('keychain locked');
        },
        describeLocation: () => 'keychain',
      },
    });
    expect(launch.mcpServers).toEqual([]);
    expect(launch.warnings).toHaveLength(2);
  });

  it('uses only enabled packs and unions their gates when no role is given', async () => {
    const both = await resolvePackLaunch({
      packs: [seo, coding],
      enabledPackIds: ['coding', 'seo'],
      secrets: secretsFrom({}),
    });
    expect(both.defaultGates).toEqual(['seo-evidence', 'tests', 'reviewer']);

    const none = await resolvePackLaunch({
      packs: [seo, coding],
      enabledPackIds: [],
      secrets: secretsFrom({}),
    });
    expect(none).toEqual({ mcpServers: [], defaultGates: [], warnings: [] });
  });

  it('applies a role: its prompt, its gates, and the pack gates when it has none', async () => {
    const secrets = secretsFrom({ GOOGLE_TOKEN: 'g' });
    const lead = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      roleId: 'lead',
      secrets,
    });
    expect(lead.appendSystemPrompt).toBe('You are the lead lane. Plan the audit.');
    expect(lead.defaultGates).toEqual(['seo-evidence', 'reviewer']);
    expect(lead.role).toEqual({ packId: 'seo', roleId: 'lead', kind: 'seo' });

    const worker = await resolvePackLaunch({
      packs: [seo],
      enabledPackIds: ['seo'],
      roleId: 'seo:worker',
      secrets,
    });
    expect(worker.defaultGates).toEqual(['seo-evidence']);
  });

  it('warns on an ambiguous or unavailable role instead of guessing', async () => {
    const secrets = secretsFrom({ GOOGLE_TOKEN: 'g' });
    const ambiguous = await resolvePackLaunch({
      packs: [seo, coding],
      enabledPackIds: ['seo', 'coding'],
      roleId: 'worker',
      secrets,
    });
    expect(ambiguous.appendSystemPrompt).toBeUndefined();
    expect(ambiguous.warnings.map((w) => w.message).join()).toMatch(/ambiguous/);

    const disabled = await resolvePackLaunch({
      packs: [seo, coding],
      enabledPackIds: ['coding'],
      roleId: 'seo:lead',
      secrets,
    });
    expect(disabled.role).toBeUndefined();
    expect(disabled.warnings[0].message).toMatch(/not in any pack enabled/);
  });

  it('keeps the first definition when two packs define the same server name', async () => {
    const other = loaded(
      manifest({
        id: 'other',
        mcpServers: [{ ...search, url: 'https://other.example.com/mcp', headers: {} }],
      })
    );
    const launch = await resolvePackLaunch({
      packs: [seo, other],
      enabledPackIds: ['seo', 'other'],
      secrets: secretsFrom({ GOOGLE_TOKEN: 'g' }),
    });
    expect(launch.mcpServers.filter((s) => s.name === 'search')).toHaveLength(1);
    expect(launch.mcpServers[0]).toMatchObject({ url: 'https://example.com/mcp' });
    expect(launch.warnings.map((w) => w.message).join()).toMatch(/also defined by pack "seo"/);
  });
});

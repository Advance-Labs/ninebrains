import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { describe, expect, it } from 'vitest';
import { seedCliOverridesForClaude, SEED_TARGET_PROVIDERS } from './seed-mcp';

function fakeServer(name: string, providers: string[]): McpServer {
  return { name, transport: 'stdio', command: 'npx', providers, env: {} };
}

describe('seedCliOverridesForClaude', () => {
  it('unions freebuff and codebuff into every Claude-synced server', () => {
    const seeded = seedCliOverridesForClaude([
      fakeServer('context7', ['claude']),
      fakeServer('notion', ['claude', 'opencode']),
      fakeServer('local', ['opencode']),
    ]);

    expect(seeded.map((server) => server.name)).toEqual(['context7', 'notion']);
    expect(seeded[0]!.providers).toEqual(['claude', ...SEED_TARGET_PROVIDERS]);
    expect(seeded[1]!.providers).toEqual(['claude', 'opencode', ...SEED_TARGET_PROVIDERS]);
  });

  it('never removes a provider and never duplicates entries', () => {
    const seeded = seedCliOverridesForClaude([
      fakeServer('shared', ['claude', 'codex', 'codebuff']),
    ]);

    expect(seeded[0]!.providers).toEqual(['claude', 'codex', 'codebuff', 'freebuff']);
  });

  it('returns [] when no server is synced with Claude', () => {
    expect(seedCliOverridesForClaude([fakeServer('local', ['opencode'])])).toEqual([]);
  });
});

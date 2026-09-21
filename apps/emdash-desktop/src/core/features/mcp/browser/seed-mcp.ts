import type { McpServer } from '@emdash/core/primitives/mcp/api';

/**
 * Providers that read the `.agents/mcp.json` file the freebuff and codebuff CLIs
 * load globally from `~/.agents/mcp.json`. Seeding appends both — one button
 * covers the shared adapter.
 */
export const SEED_TARGET_PROVIDERS = ['freebuff', 'codebuff'] as const;

/**
 * View of installed servers that should be seeded to the freebuff/codebuff tier:
 * every Claude-synced server with freebuff/codebuff unioned into `providers`.
 * Never removes a provider — a seed is strictly additive, so servers shared with
 * codex/opencode/grok keep their existing config writes untouched.
 */
export function seedCliOverridesForClaude(installed: McpServer[]): McpServer[] {
  return installed
    .filter((server) => server.providers.includes('claude'))
    .map((server) => ({
      ...server,
      providers: Array.from(new Set([...server.providers, ...SEED_TARGET_PROVIDERS])),
    }));
}

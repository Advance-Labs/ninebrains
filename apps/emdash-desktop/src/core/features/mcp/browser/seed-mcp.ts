import type { McpServer } from '@emdash/core/primitives/mcp/api';

/**
 * Providers that read the `.agents/mcp.json` file the codebuff CLI
 * loads globally from `~/.agents/mcp.json`. Seeding appends codebuff.
 * (freebuff was archived and removed from active targets.)
 */
export const SEED_TARGET_PROVIDERS = ['codebuff'] as const;

/**
 * View of installed servers that should be seeded to the codebuff tier:
 * every Claude-synced server with codebuff unioned into `providers`.
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

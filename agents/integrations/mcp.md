# MCP

## Main Files

- `src/main/core/mcp/services/McpService.ts`
- `src/main/core/mcp/utils/` — adapters, catalog, config IO, config paths, conversion
- `src/main/core/mcp/controller.ts`
- `src/core/primitives/mcp/api/`
- `src/core/features/mcp/browser/` (`mcp-view.tsx`, `components/`)
- `packages/core/src/services/agent-plugins/api/plugins/helpers/mcp.ts` — provider MCP adapters that write each CLI's config file

## Current Behavior

- MCP server configs are read, adapted, merged, and written across supported agent ecosystems
- provider-specific config formats are handled through adapters in `src/main/core/mcp/utils/`
- the renderer MCP UI manages installed servers and catalog entries
- the MCP view's "Seed from Claude" button copies every server synced with the Claude provider to
  the freebuff/codebuff tier (`~/.agents/mcp.json`). It is strictly additive: the target providers
  are unioned into each server's `providers` list, never removing existing providers such as codex
  or opencode (see `seedCliOverridesForClaude` in the mcp browser slice).

## Rules

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types and adapt at the edges
- if you add provider-specific MCP behavior, update both service and UI compatibility handling
- the freebuff/codebuff adapter is a `passthroughMcpAdapter('.agents/mcp.json')`; both CLIs load
  that file globally from the home directory, so configPath is rooted at home (the `PluginFs` root)

/**
 * What a pack contributes to one lane launch. The Phase-2 launch-config
 * builder writes `mcpServers` into the lane's `mcp.json` next to brain-mcp,
 * passes `appendSystemPrompt` with `--append-system-prompt=…`, and hands
 * `defaultGates` to the Brain as the job's gate spec.
 */

/** One `mcpServers.<name>` entry, in the shape Claude's `--mcp-config` file accepts. */
export type McpServerEntry =
  | {
      name: string;
      type: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      name: string;
      type: 'http';
      url: string;
      headers: Record<string, string>;
    };

export interface PackLaunchWarning {
  packId: string;
  server?: string;
  message: string;
  missingSecrets: string[];
}

export interface PackLaunchRole {
  packId: string;
  roleId: string;
  kind: 'code' | 'ui' | 'research' | 'seo' | 'video';
  provider?: 'claude' | 'codex';
  model?: string;
  /** The role's Lever A subagent tier (routing). */
  subagentModel?: string;
}

export interface PackLaunch {
  mcpServers: McpServerEntry[];
  appendSystemPrompt?: string;
  defaultGates: string[];
  /** Set when a role was requested and found. */
  role?: PackLaunchRole;
  warnings: PackLaunchWarning[];
}

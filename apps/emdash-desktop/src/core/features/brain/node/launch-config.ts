import { join } from 'node:path';
import type { BrainGrant } from '@ninebrains/brain-core';
import { assertSafeArgv } from '@core/features/exec-runs/api/node/argv-guard';
import {
  assertSafeSettings,
  buildClaudeSandboxSettings,
} from '@core/features/exec-runs/api/node/sandbox-settings';
import type { McpServerEntry, PackLaunch } from '@core/features/packs/api/launch';
import type { BrainEndpoint } from './endpoint';
import { buildLaneStatusHooks } from './hook-settings';
import { launchDir, ninebrainsDataDir, writePrivateFileSync } from './lane-files';

/** brain-mcp's env contract (`packages/brain-mcp/src/config.ts`). */
export const BRAIN_MCP_ENV = {
  url: 'NINEBRAINS_BRAIN_URL',
  token: 'NINEBRAINS_TOKEN',
  laneHint: 'NINEBRAINS_LANE_ID',
} as const;

/** SEC-28: pack servers may not shadow the Brain. */
const RESERVED_SERVER = /^(brain|ninebrains.*)$/i;
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export interface BrainMcpRuntime {
  /** The app's own Electron binary, run as Node, so users need no global Node (SEAMS §3.6). */
  execPath: string;
  /** The bundled `brain-mcp/bin.mjs`. */
  binPath: string;
}

export interface StdioServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function brainServerEntry(
  runtime: BrainMcpRuntime,
  url: string,
  token: string,
  laneHint?: string
): StdioServerEntry {
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    [BRAIN_MCP_ENV.url]: url,
    [BRAIN_MCP_ENV.token]: token,
  };
  if (laneHint) env[BRAIN_MCP_ENV.laneHint] = laneHint;
  return { type: 'stdio', command: runtime.execPath, args: [runtime.binPath], env };
}

/** Pack servers with safe, non-reserved names; the rest are dropped. */
export function usablePackServers(pack: PackLaunch | undefined): McpServerEntry[] {
  return (pack?.mcpServers ?? []).filter(
    (server) => SERVER_NAME.test(server.name) && !RESERVED_SERVER.test(server.name)
  );
}

/** The `--mcp-config` file body: brain-mcp plus pack servers (http ones as `type: 'http'`). */
export function buildMcpConfigJson(brain: StdioServerEntry, pack: PackLaunch | undefined): string {
  const mcpServers: Record<string, unknown> = {
    // alwaysLoad keeps the Brain tools out of ToolSearch (spike gotcha 4).
    brain: { ...brain, alwaysLoad: true },
  };
  for (const server of usablePackServers(pack)) {
    const { name, ...entry } = server;
    mcpServers[name] = entry;
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

export interface LaunchTarget {
  /** `lane:<id>` or `brain:<id>`: the endpoint ledger key. */
  launchKey: string;
  /** The launch's private directory name (SEC-14 segment). */
  launchId: string;
  provider: 'claude' | 'codex';
  worktree: string;
  grant: BrainGrant;
  laneHint?: string;
  siblingWorktrees: readonly string[];
  pack?: PackLaunch;
}

export interface LaunchConfigDeps {
  userDataDir: string;
  endpoint: Pick<BrainEndpoint, 'url' | 'mint'>;
  brainMcp: BrainMcpRuntime;
  claudeConfigDir?: string;
}

export interface UpstreamLaunchArgs {
  /** The user's provider `extraArgs`, which upstream prepends to ours. */
  extraArgs: readonly string[];
  autoApprove: boolean;
}

export interface LaneLaunch {
  extraArgs: string[];
  providerVars: Record<string, string>;
  mcpConfigPath: string;
  settingsPath: string | null;
}

/**
 * `buildLaneLaunch` (SEAMS §3.7): mints this launch's token, writes the 0600
 * `mcp.json` (and, for Claude, the `--settings` file with status hooks and the
 * sandbox), and returns the flags upstream appends. The token and pack secrets
 * live only in the server entries' env, never in `providerVars` (SEC-10).
 * Every flag is `--flag=value` (spike §3.1), and the argv guard runs over the
 * user's flags plus ours (SEC-12).
 */
export function buildLaneLaunch(
  deps: LaunchConfigDeps,
  target: LaunchTarget,
  upstream: UpstreamLaunchArgs
): LaneLaunch {
  if (upstream.autoApprove) {
    throw new Error('Refusing to launch a Brain-connected session with auto-approve on.');
  }
  const dir = launchDir(deps.userDataDir, target.launchId);
  const token = deps.endpoint.mint(target.launchKey, target.grant);
  const brain = brainServerEntry(deps.brainMcp, deps.endpoint.url, token, target.laneHint);
  const mcpConfigPath = join(dir, 'mcp.json');
  writePrivateFileSync(mcpConfigPath, buildMcpConfigJson(brain, target.pack));

  let extraArgs: string[];
  let settingsPath: string | null = null;
  if (target.provider === 'claude') {
    const sandbox = buildClaudeSandboxSettings({
      preset: 'worker',
      worktree: target.worktree,
      ninebrainsDataDir: ninebrainsDataDir(deps.userDataDir),
      siblingWorktrees: target.siblingWorktrees,
      claudeConfigDir: deps.claudeConfigDir,
    });
    assertSafeSettings(sandbox);
    settingsPath = join(dir, 'settings.json');
    writePrivateFileSync(
      settingsPath,
      JSON.stringify({ ...sandbox, hooks: buildLaneStatusHooks() }, null, 2)
    );
    extraArgs = [`--mcp-config=${mcpConfigPath}`, '--strict-mcp-config', `--settings=${settingsPath}`];
    if (target.pack?.appendSystemPrompt) {
      extraArgs.push(`--append-system-prompt=${target.pack.appendSystemPrompt}`);
    }
  } else {
    extraArgs = ['--sandbox=workspace-write', ...codexMcpOverrides(brain, target.pack)];
  }
  assertSafeArgv([...upstream.extraArgs, ...extraArgs]);
  return { extraArgs, providerVars: {}, mcpConfigPath, settingsPath };
}

const toml = (value: string) => JSON.stringify(value);
const tomlArray = (values: readonly string[]) => `[${values.map(toml).join(',')}]`;
const tomlTable = (record: Record<string, string>) =>
  `{${Object.entries(record)
    .map(([key, value]) => `${toml(key)}=${toml(value)}`)
    .join(',')}}`;

/**
 * Codex has no per-launch config file, so servers go in `--config=mcp_servers.*`
 * overrides (spike §8). Accepted risk: on Codex the token is visible in the
 * process list, the same class of exposure as R2 (Codex cannot deny reads).
 */
export function codexMcpOverrides(brain: StdioServerEntry, pack: PackLaunch | undefined): string[] {
  const out: string[] = [];
  const stdio = (name: string, entry: { command: string; args: string[]; env: Record<string, string> }) => {
    out.push(`--config=mcp_servers.${name}.command=${toml(entry.command)}`);
    out.push(`--config=mcp_servers.${name}.args=${tomlArray(entry.args)}`);
    if (Object.keys(entry.env).length > 0) {
      out.push(`--config=mcp_servers.${name}.env=${tomlTable(entry.env)}`);
    }
  };
  stdio('brain', brain);
  for (const server of usablePackServers(pack)) {
    if (server.type === 'stdio') {
      stdio(server.name, server);
    } else {
      out.push(`--config=mcp_servers.${server.name}.url=${toml(server.url)}`);
      if (Object.keys(server.headers).length > 0) {
        out.push(`--config=mcp_servers.${server.name}.http_headers=${tomlTable(server.headers)}`);
      }
    }
  }
  return out;
}

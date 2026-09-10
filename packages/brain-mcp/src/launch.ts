import { ENV } from './config';

export interface LaunchOptions {
  /** Absolute path to the built `bin.mjs`. */
  binPath: string;
  /**
   * The runtime that executes the bin. Prefer the app's own Electron binary:
   * it always ships a Node with node:sqlite, whatever `node` the user has.
   */
  runtime: { kind: 'electron'; execPath: string } | { kind: 'node'; execPath: string };
  role: 'lane' | 'brain';
  dbPath: string;
  projectId?: string;
  laneId?: string;
  brainId?: string;
  projectDir?: string;
  evidenceDir?: string;
}

export interface StdioServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The `mcpServers.<name>` entry to write into a lane's `--mcp-config` file.
 * Identity travels only in env; the agent never chooses it.
 */
export function brainMcpServerEntry(options: LaunchOptions): StdioServerEntry {
  const env: Record<string, string> = {
    [ENV.role]: options.role,
    [ENV.db]: options.dbPath,
  };
  if (options.runtime.kind === 'electron') env.ELECTRON_RUN_AS_NODE = '1';
  if (options.projectId) env[ENV.projectId] = options.projectId;
  if (options.laneId) env[ENV.laneId] = options.laneId;
  if (options.brainId) env[ENV.brainId] = options.brainId;
  if (options.projectDir) env[ENV.projectDir] = options.projectDir;
  if (options.evidenceDir) env[ENV.evidenceDir] = options.evidenceDir;
  return { type: 'stdio', command: options.runtime.execPath, args: [options.binPath], env };
}

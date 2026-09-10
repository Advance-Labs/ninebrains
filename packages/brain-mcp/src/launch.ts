import { ENV, type Role } from './config';

interface CommonLaunch {
  /** Absolute path to the built `bin.mjs`. */
  binPath: string;
  /**
   * The runtime that executes the bin. Prefer the app's own Electron binary
   * (`process.execPath` in main): users then need no global Node.
   */
  runtime: { kind: 'electron'; execPath: string } | { kind: 'node'; execPath: string };
  role: Role;
}

export type LaunchOptions = CommonLaunch &
  (
    | {
        mode: 'forward';
        /** Main's Brain endpoint base URL (loopback only). */
        url: string;
        /** The per-lane token main minted for this lane. It is the identity. */
        token: string;
        /** Informational only in forward mode; main trusts the token, not this. */
        laneId?: string;
      }
    | {
        mode: 'direct';
        dbPath: string;
        projectId?: string;
        laneId?: string;
        brainId?: string;
        projectDir?: string;
        evidenceDir?: string;
      }
  );

export interface StdioServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The `mcpServers.<name>` entry for a lane's MCP config file. The identity
 * travels only in env inside the entry; the agent never chooses it.
 */
export function brainMcpServerEntry(options: LaunchOptions): StdioServerEntry {
  const env: Record<string, string> = { [ENV.mode]: options.mode, [ENV.role]: options.role };
  if (options.runtime.kind === 'electron') env.ELECTRON_RUN_AS_NODE = '1';
  const set = (key: string, value: string | undefined) => {
    if (value) env[key] = value;
  };
  if (options.mode === 'forward') {
    set(ENV.url, options.url);
    set(ENV.token, options.token);
    set(ENV.laneId, options.laneId);
  } else {
    set(ENV.db, options.dbPath);
    set(ENV.projectId, options.projectId);
    set(ENV.laneId, options.laneId);
    set(ENV.brainId, options.brainId);
    set(ENV.projectDir, options.projectDir);
    set(ENV.evidenceDir, options.evidenceDir);
  }
  return { type: 'stdio', command: options.runtime.execPath, args: [options.binPath], env };
}

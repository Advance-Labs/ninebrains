import { ENV } from './config';

export interface LaunchOptions {
  /** Absolute path to the built `bin.mjs`. */
  binPath: string;
  /**
   * The runtime that executes the bin. Prefer the app's own Electron binary
   * (`process.execPath` in main): users then need no global Node.
   */
  runtime: { kind: 'electron'; execPath: string } | { kind: 'node'; execPath: string };
  /** Main's Brain endpoint, `http://127.0.0.1:<port>`. */
  url: string;
  /** The token main minted for this launch. It is the identity and the role. */
  token: string;
  /** Optional cross-check; main rejects every call if it does not match the token. */
  laneHint?: string;
}

export interface StdioServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The `mcpServers.brain` entry for a session's MCP config file. The same
 * entry serves lanes and Brain sessions: only the token differs. Write the
 * file under the app's userData with 0600 permissions (SEC-10), never into
 * the worktree.
 */
export function brainMcpServerEntry(options: LaunchOptions): StdioServerEntry {
  const env: Record<string, string> = { [ENV.url]: options.url, [ENV.token]: options.token };
  if (options.runtime.kind === 'electron') env.ELECTRON_RUN_AS_NODE = '1';
  if (options.laneHint) env[ENV.laneHint] = options.laneHint;
  return { type: 'stdio', command: options.runtime.execPath, args: [options.binPath], env };
}

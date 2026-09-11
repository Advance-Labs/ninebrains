import {
  startBrainHttpServer,
  TokenRegistry,
  type Brain,
  type BrainGrant,
  type BrainHttpServer,
} from '@ninebrains/brain-core';

/**
 * The Brain endpoint in main (SEC-02..SEC-06), plus a ledger that ties each
 * minted token to the launch it belongs to, so a stop, relaunch, remove or run
 * end revokes exactly that launch's token.
 *
 * Launch keys: `lane:<laneId>`, `brain:<brainId>`, `run:<runId>`.
 */
export interface BrainEndpoint {
  readonly url: string;
  readonly port: number;
  /** Mints a fresh token for `launchKey`, revoking the one it replaces. */
  mint(launchKey: string, grant: BrainGrant): string;
  revoke(launchKey: string): boolean;
  /** Number of live tokens, for tests and diagnostics. */
  liveTokens(): number;
  close(): Promise<void>;
}

export interface BrainEndpointOptions {
  brain: Brain;
  /** SEC-07: unexpected errors land here; callers only see a bare INTERNAL. */
  onInternalError(error: unknown): void;
}

export async function startBrainEndpoint(options: BrainEndpointOptions): Promise<BrainEndpoint> {
  const tokens = new TokenRegistry();
  const server: BrainHttpServer = await startBrainHttpServer({
    brain: options.brain,
    tokens,
    onInternalError: options.onInternalError,
  });
  const byLaunch = new Map<string, string>();

  const revoke = (launchKey: string): boolean => {
    const token = byLaunch.get(launchKey);
    if (token === undefined) return false;
    byLaunch.delete(launchKey);
    return server.revokeToken(token);
  };

  return {
    url: server.url,
    port: server.port,
    mint(launchKey, grant) {
      revoke(launchKey);
      const token = server.issueToken(grant);
      byLaunch.set(launchKey, token);
      return token;
    },
    revoke,
    liveTokens: () => byLaunch.size,
    async close() {
      for (const key of [...byLaunch.keys()]) revoke(key);
      await server.close();
    },
  };
}

export const laneLaunchKey = (laneId: string) => `lane:${laneId}`;
export const brainLaunchKey = (brainId: string) => `brain:${brainId}`;
export const runLaunchKey = (runId: string) => `run:${runId}`;

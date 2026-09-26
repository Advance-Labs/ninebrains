import {
  brainHandshakePath,
  removeBrainHandshake,
  startBrainHttpServer,
  TokenRegistry,
  USER_BRAIN_ID,
  writeBrainHandshake,
  type Brain,
  type BrainGrant,
  type BrainHostOps,
  type BrainHttpServer,
} from '@ninebrains/brain-core';

/**
 * The Brain endpoint in main (SEC-02..SEC-06), plus a ledger that ties each
 * minted token to the launch it belongs to, so a stop, relaunch, remove or run
 * end revokes exactly that launch's token.
 *
 * Launch keys: `lane:<laneId>`, `brain:<brainId>`, `run:<runId>`, `user`.
 */
export interface BrainEndpoint {
  readonly url: string;
  readonly port: number;
  /** Mints a fresh token for `launchKey`, revoking the one it replaces. */
  mint(launchKey: string, grant: BrainGrant): string;
  revoke(launchKey: string): boolean;
  /** Number of live tokens, for tests and diagnostics. */
  liveTokens(): number;
  /**
   * Supplies the host half of the user-role surface. The endpoint starts before
   * `BrainService` exists, so this is late-bound; until it is called the host ops
   * answer UNAVAILABLE rather than appearing to work.
   */
  attachHost(host: BrainHostOps): void;
  /**
   * Mints the operator's user token and writes the CLI handshake (SEC-10).
   * Returns the file it wrote, or null when no userData directory was given.
   */
  publishCliHandshake(): string | null;
  close(): Promise<void>;
}

export interface BrainEndpointOptions {
  brain: Brain;
  /** SEC-07: unexpected errors land here; callers only see a bare INTERNAL. */
  onInternalError(error: unknown): void;
  /**
   * `app.getPath('userData')`. The CLI handshake goes under it. Omit it and no
   * handshake is written, so no CLI can attach — which is what tests want.
   */
  userDataDir?: string;
}

export async function startBrainEndpoint(options: BrainEndpointOptions): Promise<BrainEndpoint> {
  const tokens = new TokenRegistry();
  let host: BrainHostOps | undefined;
  const server: BrainHttpServer = await startBrainHttpServer({
    brain: options.brain,
    tokens,
    onInternalError: options.onInternalError,
    // A getter, not a value: `startBrainEndpoint` runs before BrainService is
    // built, and node-http reads `options.host` per request.
    get host() {
      return host;
    },
  });
  const byLaunch = new Map<string, string>();
  const handshakeFile = options.userDataDir ? brainHandshakePath(options.userDataDir) : null;

  const revoke = (launchKey: string): boolean => {
    const token = byLaunch.get(launchKey);
    if (token === undefined) return false;
    byLaunch.delete(launchKey);
    return server.revokeToken(token);
  };

  const mint = (launchKey: string, grant: BrainGrant): string => {
    revoke(launchKey);
    const token = server.issueToken(grant);
    byLaunch.set(launchKey, token);
    return token;
  };

  return {
    url: server.url,
    port: server.port,
    mint,
    revoke,
    liveTokens: () => byLaunch.size,
    attachHost(next) {
      host = next;
    },
    publishCliHandshake() {
      if (!handshakeFile) return null;
      const token = mint(USER_LAUNCH_KEY, {
        identity: { role: 'brain', brainId: USER_BRAIN_ID },
        // The operator is not pinned to a project; the CLI names one per command.
        projectId: null,
        attachmentRoots: [],
        user: true,
      });
      return writeBrainHandshake(
        { url: server.url, token, pid: process.pid, startedAt: Date.now() },
        handshakeFile
      );
    },
    async close() {
      // Remove the handshake before revoking, so a CLI racing the shutdown sees
      // "no Brain running" rather than a 401 against a file that still exists.
      if (handshakeFile) removeBrainHandshake(handshakeFile);
      for (const key of [...byLaunch.keys()]) revoke(key);
      await server.close();
    },
  };
}

/** The operator's CLI token. One per app launch, replaced if it is re-published. */
export const USER_LAUNCH_KEY = 'user';

export const laneLaunchKey = (laneId: string) => `lane:${laneId}`;
export const brainLaunchKey = (brainId: string) => `brain:${brainId}`;
export const runLaunchKey = (runId: string) => `run:${runId}`;

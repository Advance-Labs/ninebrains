import crypto from 'node:crypto';
import http from 'node:http';
import {
  parseGitCredentialRequest,
  serializeGitCredentialResponse,
  GIT_CREDENTIAL_HELPER_URL_PATH,
  type GitCredentialChannel,
} from '@emdash/core/primitives/git-credentials/api';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type {
  GitCredentialChannelServer,
  GitCredentialSessionTarget,
} from '@core/features/github/api/node/services/git-credentials-service';
import type {
  ProjectGitHubAccountResolver,
  ProjectGitHubAccountResolution,
} from '@core/features/github/api/node/services/project-github-account-resolver';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import { resolveAccountForHost } from '@core/primitives/project-settings/api';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';

/**
 * Loopback credential server behind the emdash git credential helper
 * (spec: github-git-settings §4; secrets spec "first consumer" seam).
 *
 * Sessions carry only `{ port, nonce }` — the token stays desktop-side and is
 * re-resolved on every request through the blessed resolver, so revoking an
 * account or repointing a pin takes effect immediately and a broken pin fails
 * closed. The token travels exclusively over this loopback response body to
 * the helper's stdout; it is never logged and never enters an environment.
 */

export type GitCredentialServerDeps = {
  resolveProjectGitHubAccount: ProjectGitHubAccountResolver;
  listAccounts(): Promise<GitHubAccountSummary[]>;
  /** Token access with fail-closed pin checks (GitHubApiAuthService.getToken). */
  getToken(host: string, context: { accountId?: string }): Promise<Result<string, unknown>>;
  logger: Logger;
  /**
   * Ninebrains: encrypted storage for durable channels and the last port. Agent sessions run
   * in tmux and outlive the app, keeping the port and nonce they were spawned with in their
   * environment, which no one can update. Without this, every agent push after an app
   * restart (an update, say) hit a dead port with an unknown nonce (#150).
   */
  persistence?: GitCredentialPersistence;
};

export type GitCredentialPersistence = {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
};

/** App-secrets key for the persisted durable channels (encrypted with safeStorage). */
export const GIT_CREDENTIAL_CHANNELS_SECRET_KEY = 'git-credential-channels';

type PersistedState = {
  port: number;
  sessions: Array<[nonce: string, target: GitCredentialSessionTarget]>;
};

const MAX_BODY_BYTES = 64 * 1024;
/** PTY-session channels live as long as the session; cap to bound the map. */
const MAX_SESSIONS = 512;

export class GitCredentialServer implements GitCredentialChannelServer {
  private server: http.Server | null = null;
  private port = 0;
  private starting: Promise<number> | null = null;
  private readonly sessions = new Map<string, GitCredentialSessionTarget>();
  private readonly durable = new Set<string>();
  private restored: Promise<number> | null = null;

  constructor(private readonly deps: GitCredentialServerDeps) {}

  async mintSession(
    target: GitCredentialSessionTarget,
    options: { durable?: boolean } = {}
  ): Promise<GitCredentialChannel> {
    const port = await this.ensureStarted();
    const nonce = crypto.randomBytes(24).toString('hex');
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.forget(oldest);
    }
    this.sessions.set(nonce, target);
    if (options.durable) {
      this.durable.add(nonce);
      this.persist();
    }
    return { port, nonce };
  }

  revokeSession(nonce: string): void {
    this.forget(nonce);
  }

  private forget(nonce: string): void {
    this.sessions.delete(nonce);
    if (this.durable.delete(nonce)) this.persist();
  }

  /** Restores durable channels once; resolves to the port to try first (0 = any). */
  private restore(): Promise<number> {
    this.restored ??= (async () => {
      const raw = await this.deps.persistence?.load().catch((error: unknown) => {
        this.deps.logger.warn('GitCredentialServer: could not load saved channels', {
          error: String(error),
        });
        return null;
      });
      if (!raw) return 0;
      try {
        const state = JSON.parse(raw) as PersistedState;
        for (const [nonce, target] of state.sessions.slice(-MAX_SESSIONS)) {
          this.sessions.set(nonce, target);
          this.durable.add(nonce);
        }
        return Number.isInteger(state.port) ? state.port : 0;
      } catch {
        return 0;
      }
    })();
    return this.restored;
  }

  private persist(): void {
    if (!this.deps.persistence || this.port === 0) return;
    const state: PersistedState = {
      port: this.port,
      sessions: [...this.durable].flatMap((nonce) => {
        const target = this.sessions.get(nonce);
        return target ? [[nonce, target] as [string, GitCredentialSessionTarget]] : [];
      }),
    };
    void this.deps.persistence.save(JSON.stringify(state)).catch((error: unknown) => {
      this.deps.logger.warn('GitCredentialServer: could not save channels', {
        error: String(error),
      });
    });
  }

  stop(): void {
    this.sessions.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  /** Starts listening now, so channels restored from a previous run answer immediately. */
  async start(): Promise<void> {
    await this.ensureStarted();
  }

  private ensureStarted(): Promise<number> {
    if (this.server && this.port > 0) return Promise.resolve(this.port);
    this.starting ??= this.restore()
      .then(async (preferred) => {
        try {
          return await this.listen(preferred);
        } catch (error) {
          if (preferred === 0) throw error;
          // The old port is taken: new sessions work, restored ones cannot reach us.
          this.deps.logger.warn('GitCredentialServer: previous port unavailable', {
            port: preferred,
            error: String(error),
          });
          return this.listen(0);
        }
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  private listen(port: number): Promise<number> {
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    return new Promise<number>((resolve, reject) => {
      server.once('error', (error) => {
        this.deps.logger.error('GitCredentialServer: failed to start', { error: String(error) });
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        this.server = server;
        this.port = addr && typeof addr === 'object' ? addr.port : 0;
        this.deps.logger.info('GitCredentialServer: started', { port: this.port });
        this.persist();
        resolve(this.port);
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST' || req.url !== GIT_CREDENTIAL_HELPER_URL_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }
    const nonce = String(req.headers['x-emdash-token'] ?? '');
    const target = nonce ? this.sessions.get(nonce) : undefined;
    if (!target) {
      this.deps.logger.warn('GitCredentialServer: rejected request with unknown session nonce');
      res.writeHead(403);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      this.respond(target, body, res).catch((error) => {
        // Never include the request body or credentials in logs.
        this.deps.logger.warn('GitCredentialServer: request failed', { error: String(error) });
        res.writeHead(500);
        res.end();
      });
    });
  }

  private async respond(
    target: GitCredentialSessionTarget,
    body: string,
    res: http.ServerResponse
  ): Promise<void> {
    const request = parseGitCredentialRequest(body);
    const requestHost = normalizeRepositoryHost(request.host ?? '');
    if (request.protocol !== 'https' || !requestHost) {
      res.writeHead(404);
      res.end();
      return;
    }

    const account = await this.resolveAccount(target, requestHost);
    if (!account) {
      this.deps.logger.info('GitCredentialServer: no credential for request', {
        targetKind: target.kind,
        host: requestHost,
      });
      res.writeHead(404);
      res.end();
      return;
    }

    // getToken re-runs the fail-closed pin checks (dangling account, host
    // mismatch) so a stale session can never yield another identity.
    const token = await this.deps.getToken(requestHost, { accountId: account.accountId });
    if (!token.success) {
      this.deps.logger.warn('GitCredentialServer: token resolution failed closed', {
        targetKind: target.kind,
        host: requestHost,
        accountId: account.accountId,
      });
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(serializeGitCredentialResponse({ username: account.login, password: token.data }));
  }

  private async resolveAccount(
    target: GitCredentialSessionTarget,
    requestHost: string
  ): Promise<GitHubAccountSummary | null> {
    if (target.kind === 'host') {
      if (normalizeRepositoryHost(target.host) !== requestHost) return null;
      const inferred = resolveAccountForHost(requestHost, await this.deps.listAccounts());
      return inferred.value;
    }

    const resolution: ProjectGitHubAccountResolution = await this.deps.resolveProjectGitHubAccount(
      target.projectId
    );
    const account = resolution.value;
    if (!account) return null;
    // The helper config is scoped to the account's host; still verify, since
    // the session env could be replayed against other hosts.
    if (normalizeRepositoryHost(account.host) !== requestHost) return null;
    return account;
  }
}

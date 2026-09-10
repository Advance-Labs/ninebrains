import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Brain } from '../brain/brain';
import type { BrainGrant } from './execute';
import { BRAIN_HTTP_PATH, BRAIN_TOKEN_HEADER, MAX_REQUEST_BYTES, handleBrainHttpRequest } from './http';
import { type BrainRequest, type BrainResponse, brainFailure, brainResponseSchema } from './ops';

export interface BrainHttpServer {
  /** Base URL, e.g. `http://127.0.0.1:53121`. Hand it to lanes as NINEBRAINS_BRAIN_URL. */
  url: string;
  port: number;
  /** Mints a random token bound to `grant`. One per lane; pass it as NINEBRAINS_TOKEN. */
  issueToken(grant: BrainGrant): string;
  revokeToken(token: string): void;
  close(): Promise<void>;
}

/**
 * Reference endpoint on 127.0.0.1 (random port by default). Main can use it
 * directly, or mount `handleBrainHttpRequest` on its own hook server; tests
 * and headless runs use it as-is.
 */
export async function startBrainHttpServer(options: { brain: Brain; port?: number }): Promise<BrainHttpServer> {
  const grants = new Map<string, BrainGrant>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Stop buffering past the cap; the body is rejected whole below.
      if (size <= MAX_REQUEST_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_REQUEST_BYTES) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify(brainFailure('BAD_REQUEST', `request body exceeds ${MAX_REQUEST_BYTES} bytes`)));
        return;
      }
      const result = handleBrainHttpRequest(
        {
          method: req.method ?? '',
          path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        },
        { brain: options.brain, resolveToken: (token) => grants.get(token) ?? null }
      );
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    issueToken(grant) {
      const token = randomUUID();
      grants.set(token, grant);
      return token;
    },
    revokeToken(token) {
      grants.delete(token);
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The token must never leave the machine: only plain-HTTP loopback URLs are accepted. */
export function assertLoopbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`invalid brain URL ${value}`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError(`brain URL must be http on a loopback host, got ${value}`);
  }
  return url;
}

export interface HttpBrainClient {
  call(request: BrainRequest): Promise<BrainResponse>;
}

/**
 * Client half of the contract. Never throws: network failures come back as
 * UNAVAILABLE and unparseable replies as INTERNAL, so the shim can relay them
 * to the agent as ordinary tool errors.
 */
export function createHttpBrainClient(options: { url: string; token: string; timeoutMs?: number }): HttpBrainClient {
  const base = assertLoopbackUrl(options.url);
  const endpoint = new URL(BRAIN_HTTP_PATH, base);
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async call(request) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [BRAIN_TOKEN_HEADER]: options.token },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return brainFailure('UNAVAILABLE', `the Ninebrains app is not reachable at ${base.origin} (${reason}); is it running?`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return brainFailure('INTERNAL', `the Brain endpoint returned a non-JSON ${response.status} response`);
      }
      const parsed = brainResponseSchema.safeParse(payload);
      return parsed.success
        ? parsed.data
        : brainFailure('INTERNAL', `the Brain endpoint returned a malformed ${response.status} response`);
    },
  };
}

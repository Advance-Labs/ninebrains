import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Brain } from '../brain/brain';
import { BRAIN_ENDPOINT, LANE_HINT_HEADER } from './endpoint';
import type { BrainGrant, ExecuteOptions } from './execute';
import { type BrainHttpResponse, handleBrainHttpRequest, reply } from './http';
import { type BrainRequest, type BrainResponse, brainFailure, brainResponseSchema } from './ops';
import { type RateLimiter, createTokenBucketLimiter } from './rate-limit';
import { TokenRegistry } from './tokens';

export interface BrainHttpServerOptions extends ExecuteOptions {
  brain: Brain;
  tokens?: TokenRegistry;
  limiter?: RateLimiter;
  /** Socket timeouts. Defaults to BRAIN_ENDPOINT (5 s); tests shorten them. */
  timeouts?: { headersMs?: number; requestMs?: number; checkIntervalMs?: number };
}

export interface BrainHttpServer {
  /** `http://127.0.0.1:<port>`. Hand it to lanes as NINEBRAINS_BRAIN_URL. */
  url: string;
  port: number;
  /** The bound socket address (SEC-04: always 127.0.0.1). */
  address: AddressInfo;
  tokens: TokenRegistry;
  /** Mints a token bound to `grant`. One per launch; pass it as NINEBRAINS_TOKEN. */
  issueToken(grant: BrainGrant): string;
  revokeToken(token: string): boolean;
  close(): Promise<void>;
}

/**
 * Reference Brain endpoint (SEC-04..SEC-06). Main can run it as-is or mount
 * `handleBrainHttpRequest` on its own server with the same socket limits:
 * loopback bind, Content-Length refusal before reading, a hard cut for
 * streamed bodies, header/request timeouts, and a connection cap.
 */
export async function startBrainHttpServer(
  options: BrainHttpServerOptions
): Promise<BrainHttpServer> {
  const tokens = options.tokens ?? new TokenRegistry();
  const limiter =
    options.limiter ??
    createTokenBucketLimiter({
      ratePerSecond: BRAIN_ENDPOINT.rateLimit.perSecond,
      burst: BRAIN_ENDPOINT.rateLimit.burst,
    });
  const headersMs = options.timeouts?.headersMs ?? BRAIN_ENDPOINT.headersTimeoutMs;
  const requestMs = Math.max(
    options.timeouts?.requestMs ?? BRAIN_ENDPOINT.requestTimeoutMs,
    headersMs
  );
  let expectedHost = '';

  const server = http.createServer(
    {
      headersTimeout: headersMs,
      requestTimeout: requestMs,
      connectionsCheckingInterval: options.timeouts?.checkIntervalMs ?? 1_000,
    },
    (req, res) => {
      const send = (out: BrainHttpResponse, close = false) => {
        if (res.headersSent) return;
        res.writeHead(out.status, close ? { ...out.headers, connection: 'close' } : out.headers);
        res.end(out.body);
        if (close) res.once('finish', () => req.socket.destroy());
      };
      const tooLarge = () =>
        send(
          reply(
            413,
            brainFailure('BAD_REQUEST', `request body exceeds ${BRAIN_ENDPOINT.maxBodyBytes} bytes`)
          ),
          true
        );

      // Refuse by declared length before reading a byte of the body.
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > BRAIN_ENDPOINT.maxBodyBytes) {
        tooLarge();
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > BRAIN_ENDPOINT.maxBodyBytes) {
          // Streamed (chunked) bodies are cut at the cap, not buffered to the end.
          aborted = true;
          tooLarge();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        send(
          handleBrainHttpRequest(
            {
              method: req.method ?? '',
              path: new URL(req.url ?? '/', 'http://127.0.0.1').pathname,
              headers: req.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            },
            {
              brain: options.brain,
              tokens,
              limiter,
              expectedHost,
              onInternalError: options.onInternalError,
            }
          )
        );
      });
    }
  );
  server.maxConnections = BRAIN_ENDPOINT.maxConnections;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, BRAIN_ENDPOINT.bindHost, () => resolve());
  });
  const address = server.address() as AddressInfo;
  expectedHost = `${BRAIN_ENDPOINT.bindHost}:${address.port}`;

  return {
    url: `http://${expectedHost}`,
    port: address.port,
    address,
    tokens,
    issueToken: (grant) => tokens.issue(grant),
    revokeToken: (token) => tokens.revoke(token),
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** SEC-04: the token must never leave the machine. Only `http://127.0.0.1:<port>` is accepted. */
export function assertLoopbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('invalid brain URL');
  }
  if (url.protocol !== 'http:' || url.hostname !== BRAIN_ENDPOINT.bindHost || url.port === '') {
    throw new TypeError(`brain URL must be http://${BRAIN_ENDPOINT.bindHost}:<port>`);
  }
  return url;
}

export interface HttpBrainClient {
  call(request: BrainRequest): Promise<BrainResponse>;
}

export interface HttpBrainClientOptions {
  url: string;
  token: string;
  /** Sent as X-Ninebrains-Lane-Hint; main rejects the call if it does not match the token. */
  laneHint?: string;
  timeoutMs?: number;
}

/**
 * Client half of the contract, on `node:http` rather than `fetch`: undici's
 * fetch adds `Sec-Fetch-Mode`, which the endpoint refuses. Sends only Host,
 * Authorization, Content-Type, Content-Length and the optional hint. Never
 * throws: network failures come back as UNAVAILABLE, bad replies as INTERNAL.
 */
export function createHttpBrainClient(options: HttpBrainClientOptions): HttpBrainClient {
  const base = assertLoopbackUrl(options.url);
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    call(request) {
      return new Promise((resolve) => {
        const body = JSON.stringify(request);
        const headers: Record<string, string | number> = {
          authorization: `Bearer ${options.token}`,
          'content-type': BRAIN_ENDPOINT.contentType,
          'content-length': Buffer.byteLength(body),
        };
        if (options.laneHint) headers[LANE_HINT_HEADER] = options.laneHint;

        const req = http.request(
          {
            host: base.hostname,
            port: Number(base.port),
            path: BRAIN_ENDPOINT.path,
            method: BRAIN_ENDPOINT.method,
            headers,
            timeout: timeoutMs,
            agent: false,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', () =>
              resolve(brainFailure('UNAVAILABLE', 'the Brain connection dropped mid-response'))
            );
            res.on('end', () => {
              let payload: unknown;
              try {
                payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              } catch {
                resolve(
                  brainFailure(
                    'INTERNAL',
                    `the Brain endpoint returned a non-JSON ${res.statusCode} response`
                  )
                );
                return;
              }
              const parsed = brainResponseSchema.safeParse(payload);
              resolve(
                parsed.success
                  ? parsed.data
                  : brainFailure(
                      'INTERNAL',
                      `the Brain endpoint returned a malformed ${res.statusCode} response`
                    )
              );
            });
          }
        );
        req.on('timeout', () => req.destroy(new Error(`no response within ${timeoutMs} ms`)));
        req.on('error', (error) =>
          resolve(
            brainFailure(
              'UNAVAILABLE',
              `the Ninebrains app is not reachable at ${base.origin} (${error.message}); is it running?`
            )
          )
        );
        req.end(body);
      });
    },
  };
}

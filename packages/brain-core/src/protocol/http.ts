import type { Brain } from '../brain/brain';
import { BEARER_PATTERN, BRAIN_ENDPOINT, LANE_HINT_HEADER, RESPONSE_HEADERS, isBrowserHeader } from './endpoint';
import { type BrainGrant, type ExecuteOptions, executeBrainRequest } from './execute';
import { type BrainResponse, type BrainResponseErrorCode, brainFailure } from './ops';
import type { RateLimiter } from './rate-limit';

export interface BrainHttpRequest {
  method: string;
  /** Path without the query string. */
  path: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}

export interface BrainHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

/** Resolves a presented bearer token to its grant. `TokenRegistry` is the implementation. */
export interface TokenResolver {
  resolve(presented: unknown): Readonly<BrainGrant> | null;
}

export interface BrainHttpOptions extends ExecuteOptions {
  brain: Brain;
  tokens: TokenResolver;
  /** Exactly `127.0.0.1:<port>` of the listening socket. */
  expectedHost: string;
  limiter?: RateLimiter;
}

/**
 * The endpoint contract in `endpoint.ts`, transport-agnostic so main can
 * mount it on any Node HTTP server. Checks run cheapest and most hostile
 * first; nothing reaches the Brain until the caller is authenticated.
 */
export function handleBrainHttpRequest(request: BrainHttpRequest, options: BrainHttpOptions): BrainHttpResponse {
  const headers = lowercase(request.headers);
  const reject = (status: number, code: BrainResponseErrorCode, message: string) =>
    reply(status, brainFailure(code, message));

  if (request.path !== BRAIN_ENDPOINT.path) return reject(404, 'BAD_REQUEST', 'unknown path');
  if (request.method.toUpperCase() !== BRAIN_ENDPOINT.method) return reject(405, 'BAD_REQUEST', 'use POST');
  if (headers.host !== options.expectedHost) return reject(421, 'BAD_REQUEST', 'unexpected Host header');
  if (Object.keys(headers).some(isBrowserHeader)) {
    return reject(403, 'FORBIDDEN', 'browser requests are not accepted');
  }
  if (headers['content-type'] !== BRAIN_ENDPOINT.contentType) {
    return reject(415, 'BAD_REQUEST', `Content-Type must be exactly ${BRAIN_ENDPOINT.contentType}`);
  }

  const token = BEARER_PATTERN.exec(headers.authorization ?? '')?.[1];
  const grant = options.tokens.resolve(token);
  if (!grant) return reject(401, 'UNAUTHORIZED', 'missing or unknown brain token');

  // The shim may say which lane it thinks it is; a mismatch means a mixed-up or tampered config.
  const hint = headers[LANE_HINT_HEADER];
  if (hint !== undefined && (grant.identity.role !== 'lane' || grant.identity.laneId !== hint)) {
    return reject(401, 'UNAUTHORIZED', 'lane hint does not match the token');
  }
  if (options.limiter && !options.limiter.take(grant)) {
    return reject(429, 'RATE_LIMITED', 'too many requests; slow down');
  }
  if (Buffer.byteLength(request.body, 'utf8') > BRAIN_ENDPOINT.maxBodyBytes) {
    return reject(413, 'BAD_REQUEST', `request body exceeds ${BRAIN_ENDPOINT.maxBodyBytes} bytes`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return reject(400, 'BAD_REQUEST', 'request body is not valid JSON');
  }
  const response = executeBrainRequest(options.brain, grant, payload, options);
  return reply(!response.ok && response.error.code === 'BAD_REQUEST' ? 400 : 200, response);
}

export function reply(status: number, response: BrainResponse): BrainHttpResponse {
  return { status, headers: RESPONSE_HEADERS, body: JSON.stringify(response) };
}

function lowercase(headers: BrainHttpRequest['headers']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

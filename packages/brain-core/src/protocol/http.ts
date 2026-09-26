import type { Brain } from '../brain/brain';
import {
  BEARER_PATTERN,
  BRAIN_ENDPOINT,
  LANE_HINT_HEADER,
  RESPONSE_HEADERS,
  isBrowserHeader,
} from './endpoint';
import {
  type BrainGrant,
  type ExecuteOptions,
  executeBrainRequest,
  executeBrainRequestAsync,
} from './execute';
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
  /**
   * L3: one budget shared by all failed authentications, checked BEFORE the token is resolved.
   * Each 401 spends one; while it is spent, every request gets 429 without reaching the token
   * registry. Valid requests never spend it. Needs a limiter with `peek`.
   */
  preAuthLimiter?: RateLimiter;
}

/** The single bucket every unauthenticated caller shares. */
const PRE_AUTH_KEY = Object.freeze({ scope: 'pre-auth' });

/**
 * The endpoint contract in `endpoint.ts`, transport-agnostic so main can
 * mount it on any Node HTTP server. Checks run cheapest and most hostile
 * first; nothing reaches the Brain until the caller is authenticated.
 */
/**
 * The synchronous handler. Every transport check and every DAG operation runs
 * here. Host operations (`HOST_OPS`) need `await`, so this form answers them
 * UNAVAILABLE; a server that wires `options.host` uses
 * `handleBrainHttpRequestAsync` instead. Both share one code path, so the
 * SEC-04..SEC-06 checks cannot drift apart between them.
 */
export function handleBrainHttpRequest(
  request: BrainHttpRequest,
  options: BrainHttpOptions
): BrainHttpResponse {
  return check(request, options, (grant, payload) =>
    executeBrainRequest(options.brain, grant, payload, options)
  ) as BrainHttpResponse;
}

/** As above, and additionally serves the host operations through `options.host`. */
export function handleBrainHttpRequestAsync(
  request: BrainHttpRequest,
  options: BrainHttpOptions
): Promise<BrainHttpResponse> {
  return Promise.resolve(
    check(request, options, (grant, payload) =>
      executeBrainRequestAsync(options.brain, grant, payload, options)
    )
  );
}

function check<R extends BrainResponse | Promise<BrainResponse>>(
  request: BrainHttpRequest,
  options: BrainHttpOptions,
  execute: (grant: BrainGrant, payload: unknown) => R
): BrainHttpResponse | Promise<BrainHttpResponse> {
  const headers = lowercase(request.headers);
  const reject = (status: number, code: BrainResponseErrorCode, message: string) =>
    reply(status, brainFailure(code, message));

  if (request.path !== BRAIN_ENDPOINT.path) return reject(404, 'BAD_REQUEST', 'unknown path');
  if (request.method.toUpperCase() !== BRAIN_ENDPOINT.method)
    return reject(405, 'BAD_REQUEST', 'use POST');
  if (headers.host !== options.expectedHost)
    return reject(421, 'BAD_REQUEST', 'unexpected Host header');
  if (Object.keys(headers).some(isBrowserHeader)) {
    return reject(403, 'FORBIDDEN', 'browser requests are not accepted');
  }
  if (headers['content-type'] !== BRAIN_ENDPOINT.contentType) {
    return reject(415, 'BAD_REQUEST', `Content-Type must be exactly ${BRAIN_ENDPOINT.contentType}`);
  }

  // L3: refuse before resolving any token once failed authentications have spent the budget.
  const preAuth = options.preAuthLimiter;
  if (preAuth?.peek?.(PRE_AUTH_KEY) === false) {
    return reject(429, 'RATE_LIMITED', 'too many failed authentications; slow down');
  }
  const unauthorized = (message: string) => {
    preAuth?.take(PRE_AUTH_KEY);
    return reject(401, 'UNAUTHORIZED', message);
  };

  const token = BEARER_PATTERN.exec(headers.authorization ?? '')?.[1];
  const grant = options.tokens.resolve(token);
  if (!grant) return unauthorized('missing or unknown brain token');

  // The shim may say which lane it thinks it is; a mismatch means a mixed-up or tampered config.
  const hint = headers[LANE_HINT_HEADER];
  if (hint !== undefined && (grant.identity.role !== 'lane' || grant.identity.laneId !== hint)) {
    return unauthorized('lane hint does not match the token');
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
  const settle = (response: BrainResponse): BrainHttpResponse =>
    reply(!response.ok && response.error.code === 'BAD_REQUEST' ? 400 : 200, response);
  const response = execute(grant, payload);
  return response instanceof Promise ? response.then(settle) : settle(response);
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

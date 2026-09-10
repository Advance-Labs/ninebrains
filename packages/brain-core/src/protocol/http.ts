import type { Brain } from '../brain/brain';
import { type BrainGrant, executeBrainRequest } from './execute';
import { type BrainResponse, brainFailure } from './ops';

/**
 * HTTP binding of the forwarding contract, transport-agnostic so main can
 * mount it on its existing localhost hook server (same pattern: 127.0.0.1,
 * random port, UUID token in a header).
 *
 *   POST {BRAIN_HTTP_PATH}
 *   x-ninebrains-token: <per-lane token>
 *   content-type: application/json
 *   body: BrainRequest            ->  200 BrainResponse
 *
 * Status codes: 200 for any executed request (including `{ ok: false }`
 * Brain errors such as FORBIDDEN), 400 malformed body or request, 401 unknown
 * token, 404 wrong path, 405 wrong method, 413 body over MAX_REQUEST_BYTES.
 * Every body is a `BrainResponse`, so clients parse one shape.
 */
export const BRAIN_HTTP_PATH = '/brain/v1/call';
export const BRAIN_TOKEN_HEADER = 'x-ninebrains-token';
/** Largest request: a 32 KB body plus up to 20 attachment paths, with JSON overhead. */
export const MAX_REQUEST_BYTES = 256 * 1024;

export interface BrainHttpRequest {
  method: string;
  /** Path without the query string. */
  path: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}

export interface BrainHttpResponse {
  status: number;
  body: string;
}

export interface BrainHttpOptions {
  brain: Brain;
  /**
   * Maps a token to what it grants, or null. Authoritative for identity:
   * main mints one token per lane at spawn and only that lane's MCP entry
   * carries it.
   */
  resolveToken: (token: string) => BrainGrant | null;
}

export function handleBrainHttpRequest(request: BrainHttpRequest, options: BrainHttpOptions): BrainHttpResponse {
  if (request.path !== BRAIN_HTTP_PATH) return reply(404, brainFailure('BAD_REQUEST', `unknown path ${request.path}`));
  if (request.method.toUpperCase() !== 'POST') return reply(405, brainFailure('BAD_REQUEST', 'use POST'));

  const token = header(request.headers, BRAIN_TOKEN_HEADER);
  const grant = token ? options.resolveToken(token) : null;
  if (!grant) return reply(401, brainFailure('UNAUTHORIZED', 'missing or unknown brain token'));

  if (Buffer.byteLength(request.body, 'utf8') > MAX_REQUEST_BYTES) {
    return reply(413, brainFailure('BAD_REQUEST', `request body exceeds ${MAX_REQUEST_BYTES} bytes`));
  }
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return reply(400, brainFailure('BAD_REQUEST', 'request body is not valid JSON'));
  }
  const response = executeBrainRequest(options.brain, grant, payload);
  return reply(!response.ok && response.error.code === 'BAD_REQUEST' ? 400 : 200, response);
}

function reply(status: number, response: BrainResponse): BrainHttpResponse {
  return { status, body: JSON.stringify(response) };
}

function header(headers: BrainHttpRequest['headers'], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

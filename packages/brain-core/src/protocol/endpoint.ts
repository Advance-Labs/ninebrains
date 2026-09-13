/**
 * The Brain endpoint contract (SEC-02..SEC-06), for main's implementation.
 * `handleBrainHttpRequest` enforces all of it; `startBrainHttpServer` adds the
 * socket-level limits. Do not reuse upstream's hook-server auth: it compares
 * tokens with `!==` and has no Host check.
 *
 *   POST /brain/v1/call   HTTP/1.1
 *   Host: 127.0.0.1:<port>                 exact, else 421 (DNS rebinding)
 *   Authorization: Bearer <43-char token>  the token is the identity, else 401
 *   Content-Type: application/json         exact, else 415
 *   X-Ninebrains-Lane-Hint: <laneId>       optional; must match the token, else 401
 *   (no Origin, Referer or Sec-Fetch-* header, else 403)
 *   body: BrainRequest, at most 64 KiB    else 413
 *
 * Responses are always a JSON `BrainResponse` with no CORS headers. Other
 * statuses: 404 wrong path, 405 any method but POST (including OPTIONS),
 * 400 malformed request, 429 over the per-token rate limit or after too many failed
 * authentications (the pre-auth budget, checked before any token is resolved).
 */
import { z } from 'zod';
import { idSchema } from './ops';

export const BRAIN_ENDPOINT = {
  path: '/brain/v1/call',
  method: 'POST',
  /** SEC-04: never 0.0.0.0, :: or localhost. */
  bindHost: '127.0.0.1',
  contentType: 'application/json',
  maxBodyBytes: 64 * 1024,
  headersTimeoutMs: 5_000,
  requestTimeoutMs: 5_000,
  maxConnections: 64,
  rateLimit: { perSecond: 20, burst: 60 },
  /**
   * L3: one budget shared by every caller that fails authentication, checked before the token
   * is resolved. While it is spent, every request gets 429.
   */
  preAuthRateLimit: { perSecond: 5, burst: 20 },
} as const;

export const LANE_HINT_HEADER = 'x-ninebrains-lane-hint';

/** Headers a browser adds. A request carrying any of them is refused. */
export function isBrowserHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'origin' || lower === 'referer' || lower.startsWith('sec-fetch-');
}

export const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** The headers a valid request carries (header names lowercased, as Node delivers them). */
export const brainRequestHeadersSchema = z.object({
  host: z.string().regex(/^127\.0\.0\.1:[1-9][0-9]{0,4}$/),
  authorization: z.string().regex(BEARER_PATTERN),
  'content-type': z.literal(BRAIN_ENDPOINT.contentType),
  [LANE_HINT_HEADER]: idSchema.optional(),
});

/** Response headers: JSON only, never cached, and deliberately no Access-Control-* headers. */
export const RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
});

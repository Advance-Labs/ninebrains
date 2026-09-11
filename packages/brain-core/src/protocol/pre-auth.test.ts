import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN, makeBrain } from '../../test/helpers';
import { InMemoryBrainStore } from '../store/memory-store';
import { BRAIN_ENDPOINT } from './endpoint';
import type { BrainGrant } from './execute';
import { type BrainHttpRequest, handleBrainHttpRequest, type TokenResolver } from './http';
import { type BrainHttpServer, startBrainHttpServer } from './node-http';
import { createTokenBucketLimiter } from './rate-limit';
import { TokenRegistry } from './tokens';

const HOST = '127.0.0.1:4555';
const GOOD = 'g'.repeat(43);
const request = (token: string): BrainHttpRequest => ({
  method: 'POST',
  path: BRAIN_ENDPOINT.path,
  headers: { host: HOST, 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ v: 1, op: 'whoami', args: {} }),
});

describe('L3 pre-auth rate limit', () => {
  it('refuses failed-auth floods before any token is resolved, and valid calls never spend it', () => {
    let clock = 0;
    let resolved = 0;
    const grant: BrainGrant = { identity: BRAIN, projectId: 'p1', attachmentRoots: [] };
    const tokens: TokenResolver = {
      resolve: (presented) => {
        resolved += 1;
        return presented === GOOD ? grant : null;
      },
    };
    const options = {
      brain: makeBrain(new InMemoryBrainStore()),
      tokens,
      expectedHost: HOST,
      preAuthLimiter: createTokenBucketLimiter({ ratePerSecond: 1, burst: 3, now: () => clock }),
    };
    const status = (token: string) => handleBrainHttpRequest(request(token), options).status;

    // Valid requests don't touch the failure budget.
    for (let i = 0; i < 10; i++) expect(status(GOOD)).toBe(200);
    expect([1, 2, 3].map(() => status('b'.repeat(43)))).toEqual([401, 401, 401]);
    const before = resolved;
    expect(status('b'.repeat(43))).toBe(429);
    expect(status(GOOD)).toBe(429); // the documented trade-off while a flood is in progress
    expect(resolved).toBe(before); // refused before the token registry was consulted

    clock += 1_000; // one failure refilled
    expect(status(GOOD)).toBe(200);
  });
});

let server: BrainHttpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function post(url: string, token: string): Promise<number> {
  const body = JSON.stringify({ v: 1, op: 'whoami', args: {} });
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${url}${BRAIN_ENDPOINT.path}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('L3 startBrainHttpServer wires a pre-auth limiter by default', () => {
  it('answers 429 once invalid tokens exceed the pre-auth burst', async () => {
    const tokens = new TokenRegistry();
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()), tokens });
    const statuses: number[] = [];
    for (let i = 0; i < BRAIN_ENDPOINT.preAuthRateLimit.burst + 5; i++) {
      statuses.push(await post(server.url, 'x'.repeat(43)));
    }
    expect(statuses.slice(0, BRAIN_ENDPOINT.preAuthRateLimit.burst).every((s) => s === 401)).toBe(
      true
    );
    expect(statuses.at(-1)).toBe(429);
  });
});

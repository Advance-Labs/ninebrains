import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN, makeBrain } from '../../test/helpers';
import { InMemoryBrainStore } from '../store/memory-store';
import { BRAIN_ENDPOINT, LANE_HINT_HEADER, brainRequestHeadersSchema } from './endpoint';
import type { BrainGrant } from './execute';
import { handleBrainHttpRequest } from './http';
import { type BrainHttpServer, assertLoopbackUrl, createHttpBrainClient, startBrainHttpServer } from './node-http';
import { createTokenBucketLimiter } from './rate-limit';
import { TokenRegistry } from './tokens';

const laneA: BrainGrant = { identity: { role: 'lane', laneId: 'A', projectId: 'p1' }, projectId: 'p1', attachmentRoots: [] };
const laneB: BrainGrant = { identity: { role: 'lane', laneId: 'B', projectId: 'p1' }, projectId: 'p1', attachmentRoots: [] };
const hub: BrainGrant = { identity: BRAIN, projectId: 'p1', attachmentRoots: [] };
const HOST = '127.0.0.1:4000';

function harness() {
  const brain = makeBrain(new InMemoryBrainStore());
  const tokens = new TokenRegistry();
  const tok = { A: tokens.issue(laneA), B: tokens.issue(laneB), hub: tokens.issue(hub) };
  const handle = (
    over: { method?: string; path?: string; headers?: Record<string, string | undefined>; body?: unknown; token?: string } = {},
    limiter?: ReturnType<typeof createTokenBucketLimiter>
  ) => {
    const headers: Record<string, string> = {};
    const merged = {
      host: HOST,
      'content-type': 'application/json',
      authorization: `Bearer ${over.token ?? tok.A}`,
      ...over.headers,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined) headers[k] = v;
    const body = typeof over.body === 'string' ? over.body : JSON.stringify(over.body ?? { v: 1, op: 'list_jobs', args: {} });
    const out = handleBrainHttpRequest(
      { method: over.method ?? 'POST', path: over.path ?? BRAIN_ENDPOINT.path, headers, body },
      { brain, tokens, expectedHost: HOST, limiter }
    );
    return { ...out, json: JSON.parse(out.body) as { ok: boolean; result?: any; error?: { code: string } } };
  };
  return { brain, tokens, tok, handle };
}

describe('SEC-05 browsers cannot reach the endpoint', () => {
  it('accepts a well-formed request', () => {
    const { handle } = harness();
    expect(handle()).toMatchObject({ status: 200, json: { ok: true, result: [] } });
  });

  it.each([
    [{ method: 'OPTIONS' }, 405],
    [{ method: 'GET' }, 405],
    [{ path: '/hook' }, 404],
    [{ headers: { host: 'evil.test' } }, 421],
    [{ headers: { host: 'localhost:4000' } }, 421],
    [{ headers: { host: '127.0.0.1:4001' } }, 421],
    [{ headers: { host: undefined } }, 421],
    [{ headers: { origin: 'https://evil.test' } }, 403],
    [{ headers: { Origin: 'null' } }, 403],
    [{ headers: { referer: 'http://127.0.0.1:3000/' } }, 403],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { 'Sec-Fetch-Mode': 'no-cors' } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { 'content-type': 'application/json; charset=utf-8' } }, 415],
    [{ headers: { 'content-type': undefined } }, 415],
  ])('rejects %j with %i', (over, status) => {
    const { handle } = harness();
    expect(handle(over).status).toBe(status);
  });

  it('a no-cors text/plain POST from a page leaves the DB unchanged', () => {
    const { brain, tok, handle } = harness();
    const attack = {
      token: tok.hub,
      headers: { 'content-type': 'text/plain', origin: 'https://evil.test', 'sec-fetch-mode': 'no-cors' },
      body: { v: 1, op: 'create_job', args: { title: 'pwned' } },
    };
    expect(handle(attack).status).toBe(403);
    expect(handle({ ...attack, headers: { 'content-type': 'text/plain' } }).status).toBe(415);
    expect(brain.listJobs(BRAIN)).toEqual([]);
  });

  it('never emits CORS headers', () => {
    const { handle } = harness();
    for (const response of [handle(), handle({ method: 'OPTIONS' }), handle({ headers: { origin: 'x' } }), handle({ token: 'nope' })]) {
      expect(Object.keys(response.headers).some((h) => h.toLowerCase().startsWith('access-control-'))).toBe(false);
      expect(response.headers['content-type']).toBe('application/json');
    }
  });

  it('publishes the required request headers as a zod schema', () => {
    const { tok } = harness();
    expect(
      brainRequestHeadersSchema.safeParse({ host: HOST, authorization: `Bearer ${tok.A}`, 'content-type': 'application/json' }).success
    ).toBe(true);
    expect(brainRequestHeadersSchema.safeParse({ host: 'localhost:4000', authorization: `Bearer ${tok.A}`, 'content-type': 'application/json' }).success).toBe(false);
  });
});

describe('SEC-02 lane token cannot act as brain or another lane', () => {
  it('identity and role come from the token, not headers or the body', () => {
    const { handle, tok } = harness();
    expect(handle({ body: { v: 1, op: 'whoami', args: {} } }).json.result).toEqual({ role: 'lane', laneId: 'A', projectId: 'p1' });
    const spoofed = handle({
      headers: { 'x-lane-id': 'B', 'x-ninebrains-role': 'brain' },
      body: { v: 1, op: 'whoami', args: {}, role: 'brain', identity: { role: 'brain', brainId: 'main' } },
    });
    expect(spoofed.json.result).toMatchObject({ role: 'lane', laneId: 'A' });
    expect(handle({ token: tok.hub, body: { v: 1, op: 'whoami', args: {} } }).json.result).toMatchObject({ role: 'brain', brainId: 'main' });
  });

  it('a lane token calling create_job is FORBIDDEN', () => {
    const { handle } = harness();
    expect(handle({ body: { v: 1, op: 'create_job', args: { title: 'x' } } }).json).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it("lane A's token cannot complete lane B's job", () => {
    const { handle, tok } = harness();
    const job = handle({ token: tok.hub, body: { v: 1, op: 'create_job', args: { title: 'j' } } }).json.result;
    handle({ token: tok.B, body: { v: 1, op: 'claim_job', args: { jobId: job.id } } });
    const stolen = handle({ headers: { 'x-lane-id': 'B' }, body: { v: 1, op: 'complete_job', args: { jobId: job.id, summary: 'mine' } } });
    expect(stolen.json).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('the lane hint is cross-checked and can only cause a rejection', () => {
    const { handle, tok } = harness();
    expect(handle({ headers: { [LANE_HINT_HEADER]: 'A' } }).status).toBe(200);
    expect(handle({ headers: { [LANE_HINT_HEADER]: 'B' } }).status).toBe(401);
    expect(handle({ token: tok.hub, headers: { [LANE_HINT_HEADER]: 'A' } }).status).toBe(401);
  });
});

describe('SEC-03 token lifecycle at the endpoint', () => {
  it.each([
    [{ headers: { authorization: undefined } }],
    [{ headers: { authorization: 'Basic QTpB' } }],
    [{ headers: { authorization: 'Bearer ' } }],
    [{ token: 'short' }],
    [{ token: 'x'.repeat(43) }],
    [{ token: 'x'.repeat(5000) }],
  ])('rejects %j with 401 and no exception', (over) => {
    const { handle } = harness();
    expect(handle(over)).toMatchObject({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
  });

  it('rejects a revoked token', () => {
    const { handle, tokens, tok } = harness();
    tokens.revoke(tok.A);
    expect(handle().status).toBe(401);
  });
});

describe('SEC-06 endpoint limits (handler)', () => {
  it('rate-limits per token with 429', () => {
    const { handle, tok } = harness();
    const limiter = createTokenBucketLimiter({ burst: 2, ratePerSecond: 0.001 });
    expect([handle({}, limiter).status, handle({}, limiter).status, handle({}, limiter).status]).toEqual([200, 200, 429]);
    expect(handle({ token: tok.B }, limiter).status).toBe(200);
  });

  it('rejects bodies over 64 KiB and malformed requests', () => {
    const { handle } = harness();
    expect(handle({ body: 'x'.repeat(64 * 1024 + 1) }).status).toBe(413);
    expect(handle({ body: '{nope' }).status).toBe(400);
    expect(handle({ body: { v: 1, op: 'drop_tables', args: {} } }).status).toBe(400);
  });
});

describe('reference server and client', () => {
  let server: BrainHttpServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('SEC-04 endpoint binds loopback', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    expect(server.address.address).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
  });

  it('round-trips through the client; identity comes from the token', async () => {
    const brain = makeBrain(new InMemoryBrainStore());
    server = await startBrainHttpServer({ brain });
    const hubClient = createHttpBrainClient({ url: server.url, token: server.issueToken(hub) });
    const aClient = createHttpBrainClient({ url: server.url, token: server.issueToken(laneA), laneHint: 'A' });
    expect(await hubClient.call({ v: 1, op: 'create_job', args: { title: 'Over HTTP' } })).toMatchObject({ ok: true });
    expect(await aClient.call({ v: 1, op: 'claim_job', args: {} })).toMatchObject({ ok: true, result: { state: 'running' } });
    expect(brain.listJobs(BRAIN)[0]!.laneId).toBe('A');
    expect(await aClient.call({ v: 1, op: 'requeue_job', args: { jobId: 'x' } })).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('the client sends no browser headers and exactly the contract headers', async () => {
    let seen: http.IncomingHttpHeaders = {};
    const capture = http.createServer((req, res) => {
      seen = req.headers;
      req.resume();
      res.end(JSON.stringify({ ok: true, result: null }));
    });
    await new Promise<void>((r) => capture.listen(0, '127.0.0.1', () => r()));
    const { port } = capture.address() as AddressInfo;
    await createHttpBrainClient({ url: `http://127.0.0.1:${port}`, token: 't'.repeat(43), laneHint: 'A' }).call({ v: 1, op: 'whoami', args: {} });
    await new Promise<void>((r) => capture.close(() => r()));
    expect(Object.keys(seen).filter((h) => h === 'origin' || h === 'referer' || h.startsWith('sec-fetch-'))).toEqual([]);
    expect(seen).toMatchObject({
      host: `127.0.0.1:${port}`,
      authorization: `Bearer ${'t'.repeat(43)}`,
      'content-type': 'application/json',
      [LANE_HINT_HEADER]: 'A',
    });
  });

  it('SEC-06 endpoint limits: a 300 KiB declared body gets 413 without being read', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    const token = server.issueToken(laneA);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server!.port,
          path: BRAIN_ENDPOINT.path,
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': 300 * 1024 },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
        }
      );
      req.on('error', reject);
      req.flushHeaders(); // headers only: the body is never sent
    });
    expect(status).toBe(413);
  });

  it('SEC-06 endpoint limits: a streamed body is cut at the cap', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    const token = server.issueToken(laneA);
    const status = await new Promise<number | 'reset'>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server!.port,
          path: BRAIN_ENDPOINT.path,
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        },
        (res) => resolve(res.statusCode ?? 0)
      );
      req.on('error', () => resolve('reset'));
      req.write('x'.repeat(70 * 1024));
    });
    expect([413, 'reset']).toContain(status);
  });

  it('SEC-06 endpoint limits: 100 rapid calls from one token hit 429', async () => {
    // A frozen clock makes the budget exact: the burst of 60, then no refill.
    // Refill at 20 req/s is covered with a fake clock in tokens.test.ts.
    server = await startBrainHttpServer({
      brain: makeBrain(new InMemoryBrainStore()),
      limiter: createTokenBucketLimiter({ now: () => 0 }),
    });
    const client = createHttpBrainClient({ url: server.url, token: server.issueToken(laneA) });
    const codes: string[] = [];
    for (let i = 0; i < 100; i++) {
      const response = await client.call({ v: 1, op: 'whoami', args: {} });
      codes.push(response.ok ? 'ok' : response.error.code);
    }
    expect(codes.slice(0, 60)).toEqual(Array(60).fill('ok'));
    expect(codes.slice(60)).toEqual(Array(40).fill('RATE_LIMITED'));
  });

  it('SEC-06 endpoint limits: a slow-loris client is cut at the header timeout', async () => {
    server = await startBrainHttpServer({
      brain: makeBrain(new InMemoryBrainStore()),
      timeouts: { headersMs: 300, requestMs: 300, checkIntervalMs: 50 },
    });
    const started = Date.now();
    const closedAfter = await new Promise<number>((resolve) => {
      const socket = net.connect(server!.port, '127.0.0.1', () => socket.write(`POST ${BRAIN_ENDPOINT.path} HTTP/1.1\r\nHost: 127.0.0.1\r\n`));
      socket.on('data', () => {});
      socket.on('close', () => resolve(Date.now() - started));
      socket.on('error', () => {});
    });
    expect(closedAfter).toBeLessThan(2_000);
  });

  it('reports UNAVAILABLE when the app is not running, instead of throwing', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    const url = server.url;
    await server.close();
    server = null;
    const response = await createHttpBrainClient({ url, token: 't', timeoutMs: 2_000 }).call({ v: 1, op: 'whoami', args: {} });
    expect(response).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
});

describe('assertLoopbackUrl', () => {
  it('accepts only http://127.0.0.1:<port>', () => {
    expect(assertLoopbackUrl('http://127.0.0.1:4000').port).toBe('4000');
  });

  it.each(['http://localhost:4000', 'http://[::1]:4000', 'https://127.0.0.1:4000', 'http://127.0.0.1', 'http://10.0.0.5:80', 'not a url'])(
    'rejects %s',
    (url) => {
      expect(() => assertLoopbackUrl(url)).toThrow(TypeError);
      expect(() => createHttpBrainClient({ url, token: 't' })).toThrow(TypeError);
    }
  );
});

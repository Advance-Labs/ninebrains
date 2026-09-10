import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN, makeBrain } from '../../test/helpers';
import { InMemoryBrainStore } from '../store/memory-store';
import type { BrainGrant } from './execute';
import { BRAIN_HTTP_PATH, BRAIN_TOKEN_HEADER, MAX_REQUEST_BYTES, handleBrainHttpRequest } from './http';
import { type BrainHttpServer, assertLoopbackUrl, createHttpBrainClient, startBrainHttpServer } from './node-http';

const laneA: BrainGrant = { identity: { role: 'lane', laneId: 'A', projectId: 'p1' }, projectId: 'p1', attachmentRoots: [] };
const hub: BrainGrant = { identity: BRAIN, projectId: 'p1', attachmentRoots: [] };

describe('handleBrainHttpRequest', () => {
  const brain = makeBrain(new InMemoryBrainStore());
  const handle = (overrides: Partial<Parameters<typeof handleBrainHttpRequest>[0]>) =>
    handleBrainHttpRequest(
      {
        method: 'POST',
        path: BRAIN_HTTP_PATH,
        headers: { [BRAIN_TOKEN_HEADER]: 'good' },
        body: JSON.stringify({ v: 1, op: 'list_jobs', args: {} }),
        ...overrides,
      },
      { brain, resolveToken: (token) => (token === 'good' ? laneA : null) }
    );
  const parsed = (response: { body: string }) => JSON.parse(response.body);

  it('executes an authorized request', () => {
    const response = handle({});
    expect(response.status).toBe(200);
    expect(parsed(response)).toEqual({ ok: true, result: [] });
  });

  it.each([
    [{ path: '/hook' }, 404, 'BAD_REQUEST'],
    [{ method: 'GET' }, 405, 'BAD_REQUEST'],
    [{ headers: {} }, 401, 'UNAUTHORIZED'],
    [{ headers: { [BRAIN_TOKEN_HEADER]: 'forged' } }, 401, 'UNAUTHORIZED'],
    [{ body: '{not json' }, 400, 'BAD_REQUEST'],
    [{ body: JSON.stringify({ v: 1, op: 'nope', args: {} }) }, 400, 'BAD_REQUEST'],
    [{ body: 'x'.repeat(MAX_REQUEST_BYTES + 1) }, 413, 'BAD_REQUEST'],
  ])('rejects %j with %i', (overrides, status, code) => {
    const response = handle(overrides);
    expect(response.status).toBe(status);
    expect(parsed(response)).toMatchObject({ ok: false, error: { code } });
  });

  it('returns 200 with the error for Brain-level failures', () => {
    const response = handle({ body: JSON.stringify({ v: 1, op: 'create_job', args: { title: 'x' } }) });
    expect(response.status).toBe(200);
    expect(parsed(response)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('accepts array-valued headers', () => {
    expect(handle({ headers: { [BRAIN_TOKEN_HEADER]: ['good'] } }).status).toBe(200);
  });
});

describe('startBrainHttpServer + createHttpBrainClient', () => {
  let server: BrainHttpServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('round-trips, and identity comes from the token, not the request', async () => {
    const brain = makeBrain(new InMemoryBrainStore());
    server = await startBrainHttpServer({ brain });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const hubClient = createHttpBrainClient({ url: server.url, token: server.issueToken(hub) });
    const aClient = createHttpBrainClient({ url: server.url, token: server.issueToken(laneA) });

    const created = await hubClient.call({ v: 1, op: 'create_job', args: { title: 'Over HTTP' } });
    expect(created).toMatchObject({ ok: true, result: { state: 'ready' } });
    const claimed = await aClient.call({ v: 1, op: 'claim_job', args: {} });
    expect(claimed).toMatchObject({ ok: true, result: { state: 'running' } });
    expect(brain.listJobs(BRAIN)[0]!.laneId).toBe('A');

    // A lane token cannot perform brain operations, whatever it asks for.
    expect(await aClient.call({ v: 1, op: 'requeue_job', args: { jobId: 'x' } })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects revoked tokens and oversized bodies', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    const token = server.issueToken(laneA);
    server.revokeToken(token);
    expect(await createHttpBrainClient({ url: server.url, token }).call({ v: 1, op: 'list_jobs', args: {} })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });

    const good = server.issueToken(laneA);
    const response = await fetch(`${server.url}${BRAIN_HTTP_PATH}`, {
      method: 'POST',
      headers: { [BRAIN_TOKEN_HEADER]: good },
      body: 'x'.repeat(MAX_REQUEST_BYTES + 10),
    });
    expect(response.status).toBe(413);
  });

  it('reports UNAVAILABLE when the app is not running, instead of throwing', async () => {
    server = await startBrainHttpServer({ brain: makeBrain(new InMemoryBrainStore()) });
    const url = server.url;
    await server.close();
    server = null;
    const response = await createHttpBrainClient({ url, token: 't', timeoutMs: 2_000 }).call({
      v: 1,
      op: 'list_jobs',
      args: {},
    });
    expect(response).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  });
});

describe('assertLoopbackUrl', () => {
  it.each(['http://127.0.0.1:4000', 'http://localhost:1', 'http://[::1]:9'])('accepts %s', (url) => {
    expect(assertLoopbackUrl(url).protocol).toBe('http:');
  });

  it.each(['https://127.0.0.1:4000', 'http://10.0.0.5:80', 'http://evil.example', 'not a url'])('rejects %s', (url) => {
    expect(() => assertLoopbackUrl(url)).toThrow(TypeError);
  });

  it('refuses to build a client for a remote URL', () => {
    expect(() => createHttpBrainClient({ url: 'http://example.com', token: 't' })).toThrow(/loopback/);
  });
});

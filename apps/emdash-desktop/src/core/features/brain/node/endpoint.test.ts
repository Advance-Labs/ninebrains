import http from 'node:http';
import {
  BRAIN_ENDPOINT,
  Brain,
  InMemoryBrainStore,
  LANE_HINT_HEADER,
  type BrainGrant,
} from '@ninebrains/brain-core';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_IDENTITY } from './dispatcher';
import { startBrainEndpoint, type BrainEndpoint } from './endpoint';

let endpoint: BrainEndpoint | null = null;
let brain: Brain;
const internalErrors: unknown[] = [];

async function start(): Promise<BrainEndpoint> {
  brain = new Brain({ store: new InMemoryBrainStore() });
  endpoint = await startBrainEndpoint({ brain, onInternalError: (e) => internalErrors.push(e) });
  return endpoint;
}

afterEach(async () => {
  await endpoint?.close();
  endpoint = null;
});

const laneGrant = (laneId: string, projectId = 'p1'): BrainGrant => ({
  identity: { role: 'lane', laneId, projectId },
  projectId,
  attachmentRoots: [],
});

type Reply = { status: number; json: any };

function call(
  ep: BrainEndpoint,
  token: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: ep.port,
        path: BRAIN_ENDPOINT.path,
        method: 'POST',
        headers: {
          host: `127.0.0.1:${ep.port}`,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'content-length': String(Buffer.byteLength(data)),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

const op = (name: string, args: Record<string, unknown> = {}) => ({ v: 1, op: name, args });

function seedTwoLanes() {
  for (const id of ['A', 'B']) {
    brain.upsertLane(APP_IDENTITY, { id, projectId: 'p1', provider: 'claude', status: 'idle' });
  }
  const job = brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'held by B' });
  brain.assignJob(APP_IDENTITY, job.id, 'B');
  return job;
}

describe('SEC-04 endpoint binds loopback', () => {
  it('listens on 127.0.0.1 with a random non-zero port', async () => {
    const ep = await start();
    expect(ep.url).toBe(`http://127.0.0.1:${ep.port}`);
    expect(ep.port).toBeGreaterThan(0);
  });
});

describe('SEC-02 lane token cannot act as brain or another lane', () => {
  it('derives identity from the token alone', async () => {
    const ep = await start();
    const job = seedTwoLanes();
    const tokenA = ep.mint('lane:A', laneGrant('A'));

    const whoami = await call(ep, tokenA, op('whoami'));
    expect(whoami.json).toMatchObject({ ok: true, result: { role: 'lane', laneId: 'A' } });

    const create = await call(ep, tokenA, op('create_job', { title: 'sneaky' }), {
      'x-ninebrains-role': 'brain',
    });
    expect(create.json.ok).toBe(false);

    const complete = await call(ep, tokenA, op('complete_job', { jobId: job.id, summary: 'x' }));
    expect(complete.json).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(brain.getJob(APP_IDENTITY, job.id).state).toBe('claimed');
  });

  it('rejects a lane hint that does not match the token', async () => {
    const ep = await start();
    const tokenA = ep.mint('lane:A', laneGrant('A'));
    const spoofed = await call(ep, tokenA, op('whoami'), { [LANE_HINT_HEADER]: 'B' });
    expect(spoofed.status).toBe(401);
  });
});

describe('SEC-03 token lifecycle', () => {
  it('revokes the old token on relaunch and every token on stop', async () => {
    const ep = await start();
    const first = ep.mint('lane:A', laneGrant('A'));
    const second = ep.mint('lane:A', laneGrant('A'));
    expect((await call(ep, first, op('whoami'))).status).toBe(401);
    expect((await call(ep, second, op('whoami'))).status).toBe(200);
    expect(ep.liveTokens()).toBe(1);

    expect(ep.revoke('lane:A')).toBe(true);
    expect((await call(ep, second, op('whoami'))).status).toBe(401);
    expect(ep.liveTokens()).toBe(0);
  });

  it('answers a wrong-length token with 401 and no internal error', async () => {
    const ep = await start();
    const reply = await call(ep, 'short', op('whoami'));
    expect(reply.status).toBe(401);
    expect(internalErrors).toHaveLength(0);
  });
});

describe('SEC-05 browser-shaped requests rejected', () => {
  it('refuses Origin, Sec-Fetch, a foreign Host and non-JSON bodies, and changes nothing', async () => {
    const ep = await start();
    brain.upsertLane(APP_IDENTITY, { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' });
    const token = ep.mint('lane:A', laneGrant('A'));
    const send = op('send_message', { to: { kind: 'lane', id: 'A' }, body: 'hi' });

    expect((await call(ep, token, send, { origin: 'http://evil.test' })).status).toBe(403);
    expect((await call(ep, token, send, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call(ep, token, send, { referer: 'http://evil.test/' })).status).toBe(403);
    expect((await call(ep, token, send, { host: 'evil.test' })).status).toBe(421);
    expect((await call(ep, token, send, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(brain.store.listMessages({ to: { kind: 'lane', id: 'A' } })).toHaveLength(0);

    // The same request from a Node client (brain-mcp's shape) is accepted.
    expect((await call(ep, token, send)).json.ok).toBe(true);
    expect(brain.store.listMessages({ to: { kind: 'lane', id: 'A' } })).toHaveLength(1);
  });
});

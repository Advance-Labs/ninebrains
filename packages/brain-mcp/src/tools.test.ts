import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  Brain,
  type BrainGrant,
  type BrainHttpServer,
  type BrainResponse,
  InMemoryBrainStore,
  startBrainHttpServer,
} from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directBackend } from '../test/direct-backend';
import { type BrainBackend, forwardBackend } from './backend';
import { createBrainMcpServer } from './server';
import { SessionError, discoverSession } from './session';
import { BRAIN_TOOLS, LANE_TOOLS, type Role } from './tools';

type Call = (
  name: string,
  args?: Record<string, unknown>
) => Promise<{ isError: boolean; text: string; json: any }>;

const HUB = { role: 'brain', brainId: 'main' } as const;

let dir: string;
let brain: Brain;
let http: BrainHttpServer | null;
const clients: Client[] = [];

async function connect(backend: BrainBackend, role: Role): Promise<{ call: Call; client: Client }> {
  const server = createBrainMcpServer({ backend, role });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  clients.push(client);
  const call: Call = async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    const text = result.content.map((c) => c.text).join('\n');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { isError: result.isError === true, text, json };
  };
  return { call, client };
}

function grant(identity: BrainGrant['identity'], projectId: string): BrainGrant {
  return {
    identity,
    projectId,
    attachmentRoots: [path.join(dir, 'project'), path.join(dir, 'evidence')],
  };
}

async function app(): Promise<BrainHttpServer> {
  http ??= await startBrainHttpServer({ brain });
  return http;
}

/** The shipped transport (forward) and the test-only in-process one must behave identically. */
const MODES: Array<[string, (g: BrainGrant) => Promise<BrainBackend>]> = [
  [
    'forward',
    async (g) => forwardBackend({ url: (await app()).url, token: (await app()).issueToken(g) }),
  ],
  ['in-process test backend', async (g) => directBackend(brain, g)],
];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-mcp-tools-')));
  mkdirSync(path.join(dir, 'project'));
  mkdirSync(path.join(dir, 'evidence'));
  writeFileSync(path.join(dir, 'project', 'notes.md'), '');
  writeFileSync(path.join(dir, 'evidence', 'shot.png'), '');
  brain = new Brain({ store: new InMemoryBrainStore() });
  http = null;
  for (const [id, provider] of [
    ['A', 'claude'],
    ['B', 'codex'],
  ] as const) {
    brain.upsertLane(HUB, { id, projectId: 'p1', provider, status: 'idle' });
  }
});

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
  await http?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('lanes see lane tools without brain-only fields; brains see brain tools', async () => {
    const lane = await connect(
      directBackend(brain, grant({ role: 'lane', laneId: 'A', projectId: 'p1' }, 'p1')),
      'lane'
    );
    const hub = await connect(directBackend(brain, grant(HUB, 'p1')), 'brain');
    const laneTools = (await lane.client.listTools()).tools;
    const hubTools = (await hub.client.listTools()).tools;
    expect(laneTools.map((t) => t.name).sort()).toEqual([...LANE_TOOLS].sort());
    expect(hubTools.map((t) => t.name).sort()).toEqual([...BRAIN_TOOLS].sort());
    expect([...laneTools, ...hubTools].map((t) => t.name)).not.toContain('whoami');
    for (const tool of [...laneTools, ...hubTools])
      expect(tool.description!.length, tool.name).toBeGreaterThan(40);

    const props = (tools: typeof laneTools, name: string) =>
      Object.keys(
        (tools.find((t) => t.name === name)!.inputSchema.properties ?? {}) as object
      ).sort();
    expect(props(laneTools, 'read_inbox')).toEqual(['limit']);
    expect(props(hubTools, 'read_inbox')).toEqual(['address', 'limit']);
    expect(props(laneTools, 'list_jobs')).not.toContain('projectId');
    expect(laneTools.find((t) => t.name === 'list_jobs')!.annotations?.readOnlyHint).toBe(true);
  });
});

describe.each(MODES)('lane and brain tools (%s)', (_mode, backendFor) => {
  const lane = async (laneId: string, projectId = 'p1') =>
    (await connect(await backendFor(grant({ role: 'lane', laneId, projectId }, projectId)), 'lane'))
      .call;
  const hubCall = async () => (await connect(await backendFor(grant(HUB, 'p1')), 'brain')).call;

  it('runs a plan -> claim -> complete -> message flow', async () => {
    const hub = await hubCall();
    const laneA = await lane('A');
    const laneB = await lane('B');

    const first = (
      await hub('create_job', { title: 'Build login', body: 'x'.repeat(400), gates: ['tests'] })
    ).json;
    expect(first.state).toBe('ready');
    expect(first.body.endsWith('...')).toBe(true);
    const second = (
      await hub('create_job', { title: 'Review login', dependsOn: [first.id], kind: 'review' })
    ).json;
    expect(second.state).toBe('proposed');

    expect(
      (await laneA('list_jobs', { states: ['ready'] })).json.map((j: { id: string }) => j.id)
    ).toEqual([first.id]);
    const claimed = (await laneA('claim_job')).json;
    expect(claimed).toMatchObject({ id: first.id, state: 'running', gates: ['tests'] });
    expect(claimed.body).toHaveLength(400);

    const stolen = await laneB('claim_job', { jobId: first.id });
    expect(stolen.isError).toBe(true);
    expect(stolen.text).toMatch(/^ILLEGAL_TRANSITION/);
    expect((await laneB('claim_job')).json).toMatchObject({ claimed: null });

    const forbidden = await laneB('complete_job', { jobId: first.id, summary: 'not mine' });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.text).toMatch(/^FORBIDDEN/);

    const done = await laneA('complete_job', {
      jobId: first.id,
      summary: 'login works, tests pass',
      artifacts: ['notes.md', path.join(dir, 'evidence', 'shot.png')],
    });
    expect(done.json).toMatchObject({ state: 'verifying' });
    expect(brain.getJob(HUB, first.id).result?.artifacts).toEqual([
      path.join(dir, 'project', 'notes.md'),
      path.join(dir, 'evidence', 'shot.png'),
    ]);

    await laneA('send_message', {
      to: { kind: 'lane', id: 'B' },
      body: 'please review',
      attachments: [{ kind: 'screenshot', ref: path.join(dir, 'evidence', 'shot.png') }],
    });
    expect((await laneB('read_inbox')).json).toMatchObject([
      { from: { kind: 'lane', id: 'A' }, body: 'please review', untrusted: true },
    ]);
    expect((await laneB('read_inbox')).json).toEqual([]);

    await laneA('send_message', { to: { kind: 'brain', id: 'main' }, body: 'done with login' });
    expect((await hub('read_inbox')).json.map((m: { body: string }) => m.body)).toEqual([
      'done with login',
    ]);
  });

  it('returns validation and authorization failures as tool errors', async () => {
    const hub = await hubCall();
    const laneA = await lane('A');
    const job = (await hub('create_job', { title: 'T' })).json;
    await laneA('claim_job', { jobId: job.id });

    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['send_message', { to: 'B', body: 'hi' }, /expected object|invalid/i],
      ['send_message', { to: { kind: 'lane', id: '..' }, body: 'hi' }, /ids are/],
      [
        'send_message',
        { to: { kind: 'lane', id: 'B' }, body: 'x'.repeat(32 * 1024 + 1) },
        /32768 bytes/,
      ],
      [
        'send_message',
        {
          to: { kind: 'lane', id: 'B' },
          body: 'hi',
          attachments: [{ kind: 'file', path: '../../etc/passwd' }],
        },
        /outside|does not exist/,
      ],
      ['complete_job', { jobId: job.id, summary: 'x', artifacts: ['/etc/hosts'] }, /outside/],
      ['complete_job', { jobId: 'bad id!', summary: 'x' }, /ids are/],
      ['list_jobs', { states: ['nope'] }, /invalid/i],
      ['block_job', { jobId: job.id, reason: '' }, /too_small|at least|>=1/i],
    ];
    for (const [name, args, message] of cases) {
      const result = await laneA(name, args);
      expect(result.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`).toBe(true);
      expect(result.text).toMatch(message);
    }
    expect(brain.getJob(HUB, job.id).state).toBe('running');
  });

  it('keeps lanes out of other projects and other inboxes', async () => {
    const hub = await hubCall();
    const laneX = await lane('X', 'p2');
    const job = (await hub('create_job', { title: 'p1 only' })).json;
    expect((await laneX('claim_job', { jobId: job.id })).text).toMatch(/^NOT_FOUND/);
    expect((await laneX('list_jobs')).json).toEqual([]);
    expect((await laneX('add_note', { body: 'hi', jobId: job.id })).text).toMatch(/^NOT_FOUND/);
    // A lane cannot smuggle in the brain-only address field: it is stripped, so it reads its own inbox.
    await hub('send_message', { to: { kind: 'lane', id: 'A' }, body: 'for A' });
    expect((await laneX('read_inbox', { address: { kind: 'lane', id: 'A' } })).json).toEqual([]);
  });

  it('brain tools: link cycles, assign, block, requeue, lanes, broadcast, notes', async () => {
    const hub = await hubCall();
    const laneB = await lane('B');
    const a = (await hub('create_job', { title: 'A' })).json;
    const b = (await hub('create_job', { title: 'B', dependsOn: [a.id] })).json;

    const cycle = await hub('link_jobs', { from: b.id, to: a.id });
    expect(cycle.isError).toBe(true);
    expect(cycle.text).toContain(`CYCLE: dependency cycle: ${b.id} -> ${a.id} -> ${b.id}`);

    expect((await hub('assign_job', { jobId: a.id, laneId: 'B' })).json).toMatchObject({
      state: 'claimed',
      laneId: 'B',
    });
    expect(
      (await laneB('block_job', { jobId: a.id, reason: 'need an API key' })).json
    ).toMatchObject({
      state: 'blocked',
      reason: 'need an API key',
    });
    expect((await hub('requeue_job', { jobId: a.id })).json).toMatchObject({
      state: 'ready',
      attempts: 0,
    });
    expect((await hub('list_lanes')).json.map((l: { id: string }) => l.id)).toEqual(['A', 'B']);
    expect((await hub('broadcast', { body: 'standup at 10' })).json).toEqual([
      { kind: 'lane', id: 'A' },
      { kind: 'lane', id: 'B' },
    ]);
    expect((await hub('list_jobs', { states: ['proposed'] })).json).toMatchObject([{ id: b.id }]);
    expect((await hub('add_note', { body: 'decided on OAuth' })).json).toMatchObject({
      projectId: 'p1',
    });
    expect((await hub('read_inbox', { address: { kind: 'lane', id: 'A' } })).json).toHaveLength(1);
  });
});

describe('forward mode specifics', () => {
  it('reports an unreachable app as a tool error instead of crashing', async () => {
    const server = await app();
    const url = server.url;
    await server.close();
    http = null;
    const { call } = await connect(forwardBackend({ url, token: 'x'.repeat(43) }), 'lane');
    const result = await call('list_jobs');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^UNAVAILABLE: the Ninebrains app is not reachable/);
  });

  it('rejects a forged token', async () => {
    const { call } = await connect(
      forwardBackend({ url: (await app()).url, token: 'x'.repeat(43) }),
      'lane'
    );
    expect((await call('list_jobs')).text).toMatch(/^UNAUTHORIZED/);
  });
});

describe('SEC-02 session discovery: role comes from the token', () => {
  it('learns lane or brain from main', async () => {
    const server = await app();
    const laneSession = await discoverSession(
      forwardBackend({
        url: server.url,
        token: server.issueToken(grant({ role: 'lane', laneId: 'A', projectId: 'p1' }, 'p1')),
      })
    );
    expect(laneSession).toEqual({ role: 'lane', laneId: 'A', projectId: 'p1' });
    const brainSession = await discoverSession(
      forwardBackend({ url: server.url, token: server.issueToken(grant(HUB, 'p1')) })
    );
    expect(brainSession).toMatchObject({ role: 'brain', brainId: 'main' });
  });

  it('fails fast, without retrying, on a bad token or a mismatched lane hint', async () => {
    const server = await app();
    const token = server.issueToken(grant({ role: 'lane', laneId: 'A', projectId: 'p1' }, 'p1'));
    const counted = (backend: BrainBackend) => {
      let calls = 0;
      return {
        backend: {
          ...backend,
          call: (r: Parameters<BrainBackend['call']>[0]) => (calls++, backend.call(r)),
        },
        calls: () => calls,
      };
    };
    const forged = counted(forwardBackend({ url: server.url, token: 'y'.repeat(43) }));
    await expect(discoverSession(forged.backend, { attempts: 5, delayMs: 1 })).rejects.toThrow(
      /UNAUTHORIZED/
    );
    expect(forged.calls()).toBe(1);
    const mismatched = counted(forwardBackend({ url: server.url, token, laneHint: 'B' }));
    await expect(discoverSession(mismatched.backend, { attempts: 5, delayMs: 1 })).rejects.toThrow(
      SessionError
    );
    expect(mismatched.calls()).toBe(1);
  });

  it('retries while the app is starting, then gives up with a clear error', async () => {
    let calls = 0;
    const flaky: BrainBackend = {
      call: async (): Promise<BrainResponse> =>
        ++calls < 3
          ? { ok: false, error: { code: 'UNAVAILABLE', message: 'not up yet' } }
          : { ok: true, result: { role: 'lane', laneId: 'A', projectId: 'p1' } },
      close: () => {},
    };
    expect((await discoverSession(flaky, { attempts: 5, delayMs: 1 })).role).toBe('lane');
    expect(calls).toBe(3);

    const down: BrainBackend = {
      call: async () => ({
        ok: false,
        error: { code: 'UNAVAILABLE', message: 'connection refused' },
      }),
      close: () => {},
    };
    await expect(discoverSession(down, { attempts: 3, delayMs: 1 })).rejects.toThrow(
      /UNAVAILABLE: connection refused/
    );
  });

  it('rejects a malformed whoami answer', async () => {
    const weird: BrainBackend = {
      call: async () => ({ ok: true, result: { role: 'admin' } }),
      close: () => {},
    };
    await expect(discoverSession(weird, { attempts: 1 })).rejects.toThrow(/malformed whoami/);
  });
});

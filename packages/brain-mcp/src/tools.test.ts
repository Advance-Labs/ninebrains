import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrainMcpConfig } from './config';
import { createBrainMcpServer } from './server';
import { BRAIN_TOOLS, LANE_TOOLS } from './tools';

interface Result {
  isError: boolean;
  text: string;
  json: unknown;
}

let dir: string;
let brain: Brain;
const clients: Client[] = [];

async function connect(config: BrainMcpConfig): Promise<(name: string, args?: Record<string, unknown>) => Promise<Result>> {
  const server = createBrainMcpServer({ brain, config });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  clients.push(client);
  return async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content.map((c) => c.text).join('\n');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { isError: result.isError === true, text, json };
  };
}

const laneConfig = (laneId: string, projectId = 'p1'): BrainMcpConfig => ({
  identity: { role: 'lane', laneId, projectId },
  projectId,
  dbPath: ':unused:',
  attachmentRoots: [path.join(dir, 'project'), path.join(dir, 'evidence')],
});

const brainConfig: () => BrainMcpConfig = () => ({
  identity: { role: 'brain', brainId: 'main' },
  projectId: 'p1',
  dbPath: ':unused:',
  attachmentRoots: [path.join(dir, 'project')],
});

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-mcp-tools-')));
  mkdirSync(path.join(dir, 'project'));
  mkdirSync(path.join(dir, 'evidence'));
  writeFileSync(path.join(dir, 'project', 'notes.md'), '');
  writeFileSync(path.join(dir, 'evidence', 'shot.png'), '');
  brain = new Brain({ store: new InMemoryBrainStore() });
  for (const [id, provider] of [
    ['A', 'claude'],
    ['B', 'codex'],
  ] as const) {
    brain.upsertLane({ role: 'brain', brainId: 'main' }, { id, projectId: 'p1', provider, status: 'idle' });
  }
});

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('tool surface', () => {
  it('lanes see only lane tools; brains see brain tools and cannot claim', async () => {
    const list = async (config: BrainMcpConfig) => {
      const server = createBrainMcpServer({ brain, config });
      const [c, s] = InMemoryTransport.createLinkedPair();
      await server.connect(s);
      const client = new Client({ name: 't', version: '0' });
      await client.connect(c);
      clients.push(client);
      const { tools } = await client.listTools();
      for (const tool of tools) expect(tool.description!.length, tool.name).toBeGreaterThan(40);
      return tools.map((t) => t.name).sort();
    };
    expect(await list(laneConfig('A'))).toEqual([...LANE_TOOLS].sort());
    expect(await list(brainConfig())).toEqual([...BRAIN_TOOLS].sort());
  });
});

describe('lane and brain tools', () => {
  it('runs a full plan -> claim -> complete -> message flow', async () => {
    const hub = await connect(brainConfig());
    const laneA = await connect(laneConfig('A'));
    const laneB = await connect(laneConfig('B'));

    const first = (await hub('create_task', { title: 'Build login', body: 'x'.repeat(400), gates: ['tests'] })).json as {
      id: string;
      state: string;
      body: string;
    };
    expect(first.state).toBe('ready');
    expect(first.body.endsWith('...')).toBe(true);
    const second = (await hub('create_task', { title: 'Review login', dependsOn: [first.id], kind: 'review' })).json as {
      id: string;
      state: string;
    };
    expect(second.state).toBe('proposed');

    const listed = (await laneA('list_tasks', { states: ['ready'] })).json as Array<{ id: string }>;
    expect(listed.map((t) => t.id)).toEqual([first.id]);

    const claimed = (await laneA('claim_task')).json as { id: string; state: string; body: string; gates: string[] };
    expect(claimed).toMatchObject({ id: first.id, state: 'running', gates: ['tests'] });
    expect(claimed.body).toHaveLength(400);

    const stolen = await laneB('claim_task', { taskId: first.id });
    expect(stolen.isError).toBe(true);
    expect(stolen.text).toMatch(/^ILLEGAL_TRANSITION/);
    expect((await laneB('claim_task')).json).toMatchObject({ claimed: null });

    const forbidden = await laneB('complete_task', { taskId: first.id, summary: 'not mine' });
    expect(forbidden).toMatchObject({ isError: true });
    expect(forbidden.text).toMatch(/^FORBIDDEN/);

    const done = await laneA('complete_task', {
      taskId: first.id,
      summary: 'login works, tests pass',
      artifacts: ['notes.md', path.join(dir, 'evidence', 'shot.png')],
    });
    expect(done.json).toMatchObject({ state: 'verifying' });
    expect(brain.getTask({ role: 'brain', brainId: 'main' }, first.id).result?.artifacts).toEqual([
      path.join(dir, 'project', 'notes.md'),
      path.join(dir, 'evidence', 'shot.png'),
    ]);

    const sent = await laneA('send_message', {
      to: 'lane:B',
      body: 'please review',
      attachments: [{ kind: 'screenshot', ref: path.join(dir, 'evidence', 'shot.png') }],
    });
    expect(sent.json).toMatchObject({ to: 'lane:B', delivered: true });
    const inbox = (await laneB('read_inbox')).json as Array<{ from: string; body: string; attachments: unknown[] }>;
    expect(inbox).toMatchObject([{ from: 'lane:A', body: 'please review' }]);
    expect((await laneB('read_inbox')).json).toEqual([]);

    await laneA('send_message', { to: 'brain:main', body: 'done with login' });
    expect(((await hub('read_inbox')).json as Array<{ body: string }>).map((m) => m.body)).toEqual(['done with login']);
  });

  it('returns validation and authorization failures as tool errors', async () => {
    const laneA = await connect(laneConfig('A'));
    const hub = await connect(brainConfig());
    const task = (await hub('create_task', { title: 'T' })).json as { id: string };
    await laneA('claim_task', { taskId: task.id });

    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['send_message', { to: 'B', body: 'hi' }, /address|lane:<id>/],
      ['send_message', { to: 'lane:B', body: 'x'.repeat(32 * 1024 + 1) }, /32768 bytes/],
      ['send_message', { to: 'lane:B', body: 'hi', attachments: [{ kind: 'file', path: '../../etc/passwd' }] }, /outside|does not exist/],
      ['complete_task', { taskId: task.id, summary: 'x', artifacts: ['/etc/hosts'] }, /outside/],
      ['complete_task', { taskId: 'bad id!', summary: 'x' }, /ids are/],
      ['list_tasks', { states: ['nope'] }, /Invalid|invalid/],
      ['block', { taskId: task.id, reason: '' }, /Invalid|too_small|at least/i],
    ];
    for (const [name, args, message] of cases) {
      const result = await laneA(name, args);
      expect(result.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`).toBe(true);
      expect(result.text).toMatch(message);
    }
    // Nothing above changed the task.
    expect(brain.getTask({ role: 'brain', brainId: 'main' }, task.id).state).toBe('running');
  });

  it('a lane cannot read another inbox or reach another project', async () => {
    const hub = await connect(brainConfig());
    const laneX = await connect(laneConfig('X', 'p2'));
    const task = (await hub('create_task', { title: 'p1 only' })).json as { id: string };
    const claim = await laneX('claim_task', { taskId: task.id });
    expect(claim.text).toMatch(/^NOT_FOUND/);
    expect((await laneX('list_tasks')).json).toEqual([]);
    const note = await laneX('add_note', { body: 'hi', taskId: task.id });
    expect(note.text).toMatch(/^NOT_FOUND/);
  });

  it('brain tools: link cycles, assign, block, requeue, lanes, broadcast, notes', async () => {
    const hub = await connect(brainConfig());
    const laneB = await connect(laneConfig('B'));
    const a = (await hub('create_task', { title: 'A' })).json as { id: string };
    const b = (await hub('create_task', { title: 'B', dependsOn: [a.id] })).json as { id: string };

    const cycle = await hub('link_tasks', { from: b.id, to: a.id });
    expect(cycle.isError).toBe(true);
    expect(cycle.text).toContain(`CYCLE: dependency cycle: ${b.id} -> ${a.id} -> ${b.id}`);

    expect((await hub('assign_task', { taskId: a.id, laneId: 'B' })).json).toMatchObject({ state: 'claimed', laneId: 'B' });
    expect((await laneB('block', { taskId: a.id, reason: 'need an API key' })).json).toMatchObject({
      state: 'blocked',
      reason: 'need an API key',
    });
    expect((await hub('requeue_task', { taskId: a.id })).json).toMatchObject({ state: 'ready', attempts: 0 });

    const lanes = (await hub('list_lanes')).json as Array<{ id: string; activeTaskId: string | null }>;
    expect(lanes.map((l) => l.id)).toEqual(['A', 'B']);
    expect((await hub('broadcast', { body: 'standup at 10' })).json).toEqual(['lane:A', 'lane:B']);
    expect((await hub('list_tasks', { states: ['proposed'] })).json).toMatchObject([{ id: b.id }]);
    expect((await hub('add_note', { body: 'decided on OAuth' })).json).toMatchObject({ projectId: 'p1' });
    expect(((await hub('read_inbox', { address: 'lane:A' })).json as unknown[]).length).toBe(1);
  });
});

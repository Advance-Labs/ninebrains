import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Brain, type BrainHttpServer, SqliteBrainStore, startBrainHttpServer } from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LaunchOptions, brainMcpServerEntry } from '../src/launch';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageDir, 'dist', 'bin.mjs');
const HUB = { role: 'brain', brainId: 'main' } as const;

/** The Electron binary the desktop app pins, if it is installed in this checkout. */
function findElectron(): string | null {
  try {
    const require = createRequire(path.resolve(packageDir, '..', '..', 'apps', 'emdash-desktop', 'package.json'));
    const exe = require('electron') as unknown;
    return typeof exe === 'string' && existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

type Call = (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; json: any }>;

let dir: string;
let appBrain: Brain | null;
let app: BrainHttpServer | null;
const clients: Client[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-mcp-stdio-')));
  mkdirSync(path.join(dir, 'project'));
  writeFileSync(path.join(dir, 'project', 'report.md'), '# done');
  appBrain = null;
  app = null;
});

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
  await app?.close();
  appBrain?.close();
  rmSync(dir, { recursive: true, force: true });
});

type WithoutBin<T> = T extends unknown ? Omit<T, 'binPath'> : never;

async function launch(options: WithoutBin<LaunchOptions>): Promise<{ call: Call; client: Client }> {
  const entry = brainMcpServerEntry({ ...options, binPath: bin } as LaunchOptions);
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: { ...entry.env, PATH: process.env.PATH ?? '' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '0.0.0' });
  await client.connect(transport);
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

/** Plays the app's main process: owns the DB, runs the endpoint, mints one token per lane. */
async function startApp() {
  appBrain = new Brain({ store: SqliteBrainStore.open(dir) });
  app = await startBrainHttpServer({ brain: appBrain });
  const roots = [path.join(dir, 'project')];
  return {
    laneToken: (laneId: string) =>
      app!.issueToken({ identity: { role: 'lane', laneId, projectId: 'p1' }, projectId: 'p1', attachmentRoots: roots }),
    hubToken: () => app!.issueToken({ identity: HUB, projectId: 'p1', attachmentRoots: roots }),
  };
}

const node = { kind: 'node', execPath: process.execPath } as const;

describe('built stdio server', () => {
  it('builds a self-contained bin', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('forward mode: three shims relay to one app process that owns the DB', async () => {
    const tokens = await startApp();
    const hub = await launch({ mode: 'forward', runtime: node, role: 'brain', url: app!.url, token: tokens.hubToken() });
    const laneA = await launch({ mode: 'forward', runtime: node, role: 'lane', url: app!.url, token: tokens.laneToken('A'), laneId: 'A' });
    // B's env claims to be lane A; the app goes by the token, so it is still B.
    const laneB = await launch({ mode: 'forward', runtime: node, role: 'lane', url: app!.url, token: tokens.laneToken('B'), laneId: 'A' });

    expect(laneA.client.getServerVersion()?.name).toBe('ninebrains-brain');
    expect(laneA.client.getInstructions()).toContain('claim_job');

    const job = (await hub.call('create_job', { title: 'Write the report' })).json;
    expect((await laneA.call('claim_job', { jobId: job.id })).json).toMatchObject({ id: job.id, state: 'running' });
    const loser = await laneB.call('claim_job', { jobId: job.id });
    expect(loser.text).toMatch(/^ILLEGAL_TRANSITION/);
    expect((await laneB.call('complete_job', { jobId: job.id, summary: 'impersonating' })).text).toMatch(/^FORBIDDEN/);

    expect((await laneA.call('complete_job', { jobId: job.id, summary: 'written', artifacts: ['report.md'] })).json).toMatchObject({
      state: 'verifying',
    });
    await laneA.call('send_message', { to: 'lane:B', body: 'report is in', attachments: [{ kind: 'file', path: 'report.md' }] });
    const inbox = (await laneB.call('read_inbox')).json;
    expect(inbox).toMatchObject([{ from: 'lane:A', body: 'report is in' }]);
    expect(inbox[0].attachments[0].path).toBe(path.join(dir, 'project', 'report.md'));
    expect(appBrain!.getJob(HUB, job.id)).toMatchObject({ state: 'verifying', laneId: 'A' });
  });

  it('direct mode: three processes share one DB file', async () => {
    const common = { mode: 'direct', runtime: node, dbPath: path.join(dir, 'brain.sqlite'), projectId: 'p1', projectDir: path.join(dir, 'project') } as const;
    const hub = await launch({ ...common, role: 'brain' });
    const laneA = await launch({ ...common, role: 'lane', laneId: 'A' });
    const laneB = await launch({ ...common, role: 'lane', laneId: 'B' });

    const job = (await hub.call('create_job', { title: 'Direct' })).json;
    expect((await laneA.call('claim_job')).json).toMatchObject({ id: job.id, state: 'running' });
    expect((await laneB.call('claim_job', { jobId: job.id })).text).toMatch(/^ILLEGAL_TRANSITION/);
    expect((await laneA.call('complete_job', { jobId: job.id, summary: 'ok', artifacts: ['report.md'] })).json).toMatchObject({
      state: 'verifying',
    });
    expect((await hub.call('list_jobs', { states: ['verifying'] })).json).toMatchObject([{ id: job.id, laneId: 'A' }]);
  });

  it('exits with a clear error when misconfigured', () => {
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, [bin], { env: { PATH: process.env.PATH ?? '', ...env }, input: '', encoding: 'utf8' });
    const noUrl = run({});
    expect(noUrl.status).toBe(2);
    expect(noUrl.stderr).toContain('NINEBRAINS_BRAIN_URL is required');
    const noLane = run({ NINEBRAINS_MODE: 'direct', NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite') });
    expect(noLane.status).toBe(2);
    expect(noLane.stderr).toContain('NINEBRAINS_LANE_ID is required');
  });

  it('direct mode does not leak the node:sqlite experimental warning', () => {
    const result = spawnSync(process.execPath, [bin], {
      env: {
        PATH: process.env.PATH ?? '',
        NINEBRAINS_MODE: 'direct',
        NINEBRAINS_ROLE: 'brain',
        NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite'),
      },
      input: '',
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ExperimentalWarning');
    expect(existsSync(path.join(dir, 'brain.sqlite'))).toBe(true);
  });

  const electron = findElectron();
  it.skipIf(!electron)('runs under the pinned Electron binary with ELECTRON_RUN_AS_NODE=1 (forward and direct)', async () => {
    const tokens = await startApp();
    const runtime = { kind: 'electron', execPath: electron! } as const;
    const forward = await launch({ mode: 'forward', runtime, role: 'lane', url: app!.url, token: tokens.laneToken('E') });
    expect((await forward.client.listTools()).tools.map((t) => t.name)).toContain('claim_job');
    expect((await forward.call('claim_job')).json).toMatchObject({ claimed: null });

    const direct = await launch({ mode: 'direct', runtime, role: 'lane', laneId: 'F', projectId: 'p1', dbPath: path.join(dir, 'direct.sqlite') });
    expect((await direct.call('list_jobs')).json).toEqual([]);
  });
});

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  Brain,
  type BrainHttpServer,
  SqliteBrainStore,
  startBrainHttpServer,
} from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LaunchOptions, brainMcpServerEntry } from '../src/launch';
import { LANE_TOOLS } from '../src/tools';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageDir, 'dist', 'bin.mjs');
const HUB = { role: 'brain', brainId: 'main' } as const;

/** The Electron binary the desktop app pins, if it is installed in this checkout. */
function findElectron(): string | null {
  try {
    const require = createRequire(
      path.resolve(packageDir, '..', '..', 'apps', 'emdash-desktop', 'package.json')
    );
    const exe = require('electron') as unknown;
    return typeof exe === 'string' && existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

type Call = (
  name: string,
  args?: Record<string, unknown>
) => Promise<{ isError: boolean; text: string; json: any }>;

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

/** Plays the app's main process: the only DB opener, the endpoint, and the token minter. */
async function startApp() {
  appBrain = new Brain({ store: SqliteBrainStore.open(path.join(dir, 'app-data')) });
  // Main registers every lane it launches; L1 refuses messages to lanes that don't exist.
  for (const id of ['A', 'B']) {
    appBrain.upsertLane(HUB, { id, projectId: 'p1', provider: 'claude', status: 'idle' });
  }
  app = await startBrainHttpServer({ brain: appBrain });
  const roots = [path.join(dir, 'project')];
  return {
    laneToken: (laneId: string) =>
      app!.issueToken({
        identity: { role: 'lane', laneId, projectId: 'p1' },
        projectId: 'p1',
        attachmentRoots: roots,
      }),
    hubToken: () => app!.issueToken({ identity: HUB, projectId: 'p1', attachmentRoots: roots }),
  };
}

const node = { kind: 'node', execPath: process.execPath } as const;

async function launch(
  options: Omit<LaunchOptions, 'binPath'>,
  extraEnv: Record<string, string> = {}
) {
  const entry = brainMcpServerEntry({ ...options, binPath: bin });
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: { ...entry.env, ...extraEnv, PATH: process.env.PATH ?? '' },
    cwd: dir,
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

/** Runs the bin to completion (stdin closed at once). Async, so the in-process app can answer. */
function runBin(env: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin], {
      env: { PATH: process.env.PATH ?? '', ...env },
      cwd: dir,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end();
  });
}

describe('built stdio shim', () => {
  it('SEC-01 brain-mcp has no DB access: every tool works with no DB setting, over one app process', async () => {
    const tokens = await startApp();
    const hub = await launch({ runtime: node, url: app!.url, token: tokens.hubToken() });
    const laneA = await launch({
      runtime: node,
      url: app!.url,
      token: tokens.laneToken('A'),
      laneHint: 'A',
    });
    const laneB = await launch({ runtime: node, url: app!.url, token: tokens.laneToken('B') });

    expect(laneA.client.getServerVersion()?.name).toBe('ninebrains-brain');
    expect(laneA.client.getInstructions()).toContain('claim_job');

    const job = (await hub.call('create_job', { title: 'Write the report' })).json;
    expect((await laneA.call('claim_job', { jobId: job.id })).json).toMatchObject({
      id: job.id,
      state: 'running',
    });
    expect((await laneB.call('claim_job', { jobId: job.id })).text).toMatch(/^ILLEGAL_TRANSITION/);
    expect(
      (
        await laneA.call('complete_job', {
          jobId: job.id,
          summary: 'written',
          artifacts: ['report.md'],
        })
      ).json
    ).toMatchObject({
      state: 'verifying',
    });
    await laneA.call('send_message', {
      to: { kind: 'lane', id: 'B' },
      body: 'report is in',
      attachments: [{ kind: 'file', path: 'report.md' }],
    });
    const inbox = (await laneB.call('read_inbox')).json;
    expect(inbox).toMatchObject([{ from: { kind: 'lane', id: 'A' }, untrusted: true }]);
    // The built bin fences every untrusted body it hands a lane (gate-feedback provenance).
    expect(inbox[0].body).toMatch(
      /^<<<MESSAGE-([0-9a-f]{16})>>>\nreport is in\n<<<END-MESSAGE-\1>>>$/
    );
    expect(inbox[0].fence).toContain('UNTRUSTED DATA');
    expect(inbox[0].attachments[0].path).toBe(path.join(dir, 'project', 'report.md'));
    expect((await laneA.call('add_note', { body: 'uses port 3001' })).isError).toBe(false);
    const other = (await hub.call('create_job', { title: 'Needs credentials' })).json;
    await laneB.call('claim_job', { jobId: other.id });
    expect(
      (await laneB.call('block_job', { jobId: other.id, reason: 'no API key' })).json
    ).toMatchObject({ state: 'blocked' });
    expect(
      (await laneA.call('list_jobs', { mine: true })).json.map((j: { id: string }) => j.id)
    ).toEqual([job.id]);
    expect(appBrain!.getJob(HUB, job.id)).toMatchObject({ state: 'verifying', laneId: 'A' });
    // No shim created a database anywhere it could reach.
    expect(existsSync(path.join(dir, 'brain.sqlite'))).toBe(false);
  });

  it('SEC-02 lane token cannot act as brain or another lane', async () => {
    const tokens = await startApp();
    const job = appBrain!.createJob(HUB, { projectId: 'p1', title: 'held by B' });
    appBrain!.upsertLane(HUB, { id: 'B', projectId: 'p1', provider: 'codex', status: 'idle' });
    appBrain!.assignJob(HUB, job.id, 'B');

    // Lane A's token, with env claiming the brain role and a brain DB: still a lane.
    const laneA = await launch(
      { runtime: node, url: app!.url, token: tokens.laneToken('A') },
      {
        NINEBRAINS_ROLE: 'brain',
        NINEBRAINS_MODE: 'direct',
        NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite'),
      }
    );
    expect((await laneA.client.listTools()).tools.map((t) => t.name).sort()).toEqual(
      [...LANE_TOOLS].sort()
    );
    let createText = '';
    try {
      createText = (await laneA.call('create_job', { title: 'escalate' })).text;
    } catch (error) {
      createText = (error as Error).message;
    }
    expect(createText).toMatch(/not found|unknown tool/i);
    expect((await laneA.call('complete_job', { jobId: job.id, summary: 'mine now' })).text).toMatch(
      /^FORBIDDEN/
    );
    expect(existsSync(path.join(dir, 'brain.sqlite'))).toBe(false);

    // Lane B's token with a hint claiming to be A: main rejects it, so the shim refuses to start.
    const mismatched = await runBin({
      NINEBRAINS_BRAIN_URL: app!.url,
      NINEBRAINS_TOKEN: tokens.laneToken('B'),
      NINEBRAINS_LANE_ID: 'A',
    });
    expect(mismatched.code).toBe(1);
    expect(mismatched.stderr).toContain('lane hint does not match');
  });

  it('exits with a clear error when misconfigured, and never enters direct mode', async () => {
    const noUrl = await runBin({
      NINEBRAINS_MODE: 'direct',
      NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite'),
    });
    expect(noUrl.code).toBe(2);
    expect(noUrl.stderr).toContain('NINEBRAINS_BRAIN_URL is required');
    expect(existsSync(path.join(dir, 'brain.sqlite'))).toBe(false);

    const badToken = await runBin({
      NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:9',
      NINEBRAINS_TOKEN: 'leaky-secret',
    });
    expect(badToken.code).toBe(2);
    expect(badToken.stderr).not.toContain('leaky-secret');
  });

  const electron = findElectron();
  it.skipIf(!electron)(
    'runs under the pinned Electron binary with ELECTRON_RUN_AS_NODE=1',
    async () => {
      const tokens = await startApp();
      const lane = await launch({
        runtime: { kind: 'electron', execPath: electron! },
        url: app!.url,
        token: tokens.laneToken('E'),
      });
      expect((await lane.client.listTools()).tools.map((t) => t.name)).toContain('claim_job');
      expect((await lane.call('claim_job')).json).toMatchObject({ claimed: null });
    }
  );
});

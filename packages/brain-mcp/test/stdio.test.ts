import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brainMcpServerEntry, type LaunchOptions } from '../src/launch';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageDir, 'dist', 'bin.mjs');

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

let dir: string;
const clients: Client[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-mcp-stdio-')));
  mkdirSync(path.join(dir, 'project'));
  writeFileSync(path.join(dir, 'project', 'report.md'), '# done');
});

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
  rmSync(dir, { recursive: true, force: true });
});

type Call = (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; json: unknown }>;

async function launch(options: Omit<LaunchOptions, 'binPath' | 'dbPath'>): Promise<{ call: Call; client: Client }> {
  const entry = brainMcpServerEntry({ ...options, binPath: bin, dbPath: path.join(dir, 'brain.sqlite') });
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

const node = { kind: 'node', execPath: process.execPath } as const;

describe('built stdio server', () => {
  it('builds a self-contained bin', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('round-trips across three server processes sharing one DB file', async () => {
    const hub = await launch({ runtime: node, role: 'brain', projectId: 'p1', projectDir: path.join(dir, 'project') });
    const laneA = await launch({ runtime: node, role: 'lane', laneId: 'A', projectId: 'p1', projectDir: path.join(dir, 'project') });
    const laneB = await launch({ runtime: node, role: 'lane', laneId: 'B', projectId: 'p1', projectDir: path.join(dir, 'project') });

    expect(laneA.client.getServerVersion()?.name).toBe('ninebrains-brain');
    expect(laneA.client.getInstructions()).toContain('claim_job');

    const job = (await hub.call('create_job', { title: 'Write the report' })).json as { id: string };
    const claimed = await laneA.call('claim_job', { jobId: job.id });
    expect(claimed.json).toMatchObject({ id: job.id, state: 'running' });

    const loser = await laneB.call('claim_job', { jobId: job.id });
    expect(loser.isError).toBe(true);
    expect(loser.text).toMatch(/^ILLEGAL_TRANSITION/);

    const complete = await laneA.call('complete_job', { jobId: job.id, summary: 'written', artifacts: ['report.md'] });
    expect(complete.json).toMatchObject({ state: 'verifying' });

    await laneA.call('send_message', { to: 'lane:B', body: 'report is in', attachments: [{ kind: 'file', path: 'report.md' }] });
    const inbox = (await laneB.call('read_inbox')).json as Array<{ body: string; attachments: Array<{ path: string }> }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.attachments[0]!.path).toBe(path.join(dir, 'project', 'report.md'));

    expect((await hub.call('list_jobs', { states: ['verifying'] })).json).toMatchObject([{ id: job.id, laneId: 'A' }]);
  });

  it('exits with a clear error when its identity env is missing', () => {
    const result = spawnSync(process.execPath, [bin], {
      env: { PATH: process.env.PATH, NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite') },
      input: '',
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('NINEBRAINS_LANE_ID is required');
  });

  it('does not leak the node:sqlite experimental warning to stderr', () => {
    const result = spawnSync(process.execPath, [bin], {
      env: { PATH: process.env.PATH, NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_DB: path.join(dir, 'brain.sqlite') },
      input: '',
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('ExperimentalWarning');
    expect(existsSync(path.join(dir, 'brain.sqlite'))).toBe(true);
  });

  const electron = findElectron();
  it.skipIf(!electron)('runs under the pinned Electron binary with ELECTRON_RUN_AS_NODE=1', async () => {
    const lane = await launch({ runtime: { kind: 'electron', execPath: electron! }, role: 'lane', laneId: 'E', projectId: 'p1' });
    const { tools } = await lane.client.listTools();
    expect(tools.map((t) => t.name)).toContain('claim_job');
    expect((await lane.call('claim_job')).json).toMatchObject({ claimed: null });
  });
});

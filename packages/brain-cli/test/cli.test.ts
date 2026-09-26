import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Brain,
  brainHandshakePath,
  InMemoryBrainStore,
  startBrainHttpServer,
  USER_BRAIN_ID,
  writeBrainHandshake,
  type BrainHostOps,
  type BrainHttpServer,
} from '@ninebrains/brain-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, runCli } from '../src/cli';

/**
 * End to end over the real endpoint: a real `Brain`, the real loopback HTTP
 * server with its SEC-04..SEC-06 checks, a real minted user token and a real
 * handshake file on disk. Only the host half is a fake, because it stands in for
 * the desktop app's process control.
 */

const BRAIN_IDENTITY = { role: 'brain', brainId: 'main' } as const;

let server: BrainHttpServer;
let userData: string;
let env: NodeJS.ProcessEnv;
let hostCalls: string[];
let out: string[];
let err: string[];

const io = {
  out: (line: string) => out.push(line),
  err: (line: string) => err.push(line),
};

function fakeHost(): BrainHostOps {
  const note =
    (name: string, result: unknown = { ok: true }) =>
    () => {
      hostCalls.push(name);
      return Promise.resolve(result);
    };
  return {
    listDone: note('listDone', []),
    listNotes: note('listNotes', []),
    dispatcherStatus: note('dispatcherStatus', { paused: false, stopLatched: false }),
    setDispatcherPaused: note('setDispatcherPaused', null),
    setLaneMode: note('setLaneMode', null),
    listSessions: note('listSessions', []),
    startBrain: note('startBrain', { brainId: 'hub-1' }),
    stopBrain: note('stopBrain', null),
    stopAll: note('stopAll', { killedRuns: 2, stoppedLanes: 1 }),
    clearStop: note('clearStop', null),
  };
}

async function run(line: string): Promise<number> {
  out = [];
  err = [];
  return runCli({ argv: line.split(' ').filter(Boolean), env, io });
}

const stdout = (): string => out.join('\n');
const stderr = (): string => err.join('\n');

beforeEach(async () => {
  hostCalls = [];
  const store = new InMemoryBrainStore();
  const brain = new Brain({ store, resolveGateFloor: () => [] });
  brain.upsertLane(BRAIN_IDENTITY, {
    id: 'A',
    projectId: 'alpha',
    provider: 'claude',
    status: 'idle',
  });
  server = await startBrainHttpServer({ brain, host: fakeHost() });
  const token = server.issueToken({
    identity: { role: 'brain', brainId: USER_BRAIN_ID },
    projectId: null,
    attachmentRoots: [],
    user: true,
  });
  userData = mkdtempSync(path.join(tmpdir(), 'brain-cli-'));
  const file = brainHandshakePath(userData);
  writeBrainHandshake({ url: server.url, token, pid: process.pid, startedAt: Date.now() }, file);
  env = { NINEBRAINS_BRAIN_HANDSHAKE: file, NINEBRAINS_PROJECT: 'alpha' };
});

afterEach(async () => {
  await server.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('brain CLI over the real endpoint', () => {
  it('whoami reports the user role', async () => {
    expect(await run('whoami')).toBe(EXIT.ok);
    expect(JSON.parse(stdout())).toMatchObject({ role: 'user' });
  });

  it('creates, lists and links jobs', async () => {
    expect(await run('new build the thing')).toBe(EXIT.ok);
    const created = JSON.parse(stdout()) as { id: string; title: string };
    expect(created.title).toBe('build the thing');

    expect(await run('new ship the thing')).toBe(EXIT.ok);
    const second = JSON.parse(stdout()) as { id: string };

    expect(await run(`link ${created.id} ${second.id}`)).toBe(EXIT.ok);

    expect(await run('jobs')).toBe(EXIT.ok);
    const jobs = JSON.parse(stdout()) as Array<{ id: string; state: string }>;
    expect(jobs.map((job) => job.id).sort()).toEqual([created.id, second.id].sort());
    // The dependent job waits, so only the prerequisite is ready.
    expect(jobs.find((job) => job.id === second.id)?.state).toBe('proposed');
  });

  it('reaches the host ops the desktop UI used to own', async () => {
    expect(await run('status')).toBe(EXIT.ok);
    expect(await run('pause')).toBe(EXIT.ok);
    expect(await run('resume')).toBe(EXIT.ok);
    expect(await run('sessions')).toBe(EXIT.ok);
    expect(await run('session-start')).toBe(EXIT.ok);
    expect(await run('session-stop hub-1')).toBe(EXIT.ok);
    expect(await run('mode A unattended')).toBe(EXIT.ok);
    expect(await run('done')).toBe(EXIT.ok);
    expect(await run('notes')).toBe(EXIT.ok);
    expect(hostCalls).toEqual([
      'dispatcherStatus',
      'setDispatcherPaused',
      'setDispatcherPaused',
      'listSessions',
      'startBrain',
      'stopBrain',
      'setLaneMode',
      'listDone',
      'listNotes',
    ]);
  });

  it('SEC-30: stop and stop-clear work, and stop reports what it killed', async () => {
    expect(await run('stop')).toBe(EXIT.ok);
    expect(JSON.parse(stdout())).toEqual({ killedRuns: 2, stoppedLanes: 1 });
    expect(await run('stop-clear')).toBe(EXIT.ok);
    expect(hostCalls).toEqual(['stopAll', 'clearStop']);
  });

  it('messages a lane and reads the inbox back', async () => {
    expect(await run('send lane:A look at this')).toBe(EXIT.ok);
    expect(await run('inbox --address lane:A')).toBe(EXIT.ok);
    const inbox = JSON.parse(stdout()) as Array<{ body: string; from: { id: string } }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ body: 'look at this', from: { id: USER_BRAIN_ID } });
  });

  it('reports an endpoint error on stderr with exit 1', async () => {
    expect(await run('requeue no-such-job')).toBe(EXIT.failed);
    expect(stderr()).toContain('NOT_FOUND');
    expect(stdout()).toBe('');
  });

  it('--json prints the error envelope on stdout instead, for scripts', async () => {
    expect(await run('requeue no-such-job --json')).toBe(EXIT.failed);
    expect(JSON.parse(stdout())).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('refuses an unknown command and lists the real ones', async () => {
    expect(await run('frobnicate')).toBe(EXIT.usage);
    expect(stderr()).toContain('unknown command');
    expect(stderr()).toContain('stop');
  });

  it('explains a missing argument with that command usage, and sends nothing', async () => {
    expect(await run('link only-one')).toBe(EXIT.usage);
    expect(stderr()).toContain('missing <to>');
    expect(stderr()).toContain('brain link');
  });

  it('explains a malformed address before opening a connection', async () => {
    expect(await run('send notanaddress hello')).toBe(EXIT.usage);
    expect(stderr()).toContain('lane:<id>');
  });

  it('asks for a project when neither the flag nor the env var gives one', async () => {
    env = { ...env, NINEBRAINS_PROJECT: undefined };
    expect(await run('note a thought')).toBe(EXIT.usage);
    expect(stderr()).toContain('NINEBRAINS_PROJECT');
  });

  it('--dry-run prints the request and never reaches the endpoint', async () => {
    await server.close();
    expect(await run('stop --dry-run')).toBe(EXIT.ok);
    expect(JSON.parse(stdout())).toEqual({ v: 1, op: 'stop_all', args: {} });
    // Reopen so afterEach's close does not throw.
    server = await startBrainHttpServer({ brain: new Brain({ store: new InMemoryBrainStore() }) });
  });

  it('exits 3 with actionable text when no Brain is running', async () => {
    expect(await run('status --json')).toBe(EXIT.ok);
    env = { NINEBRAINS_BRAIN_HANDSHAKE: path.join(userData, 'gone.json') };
    expect(await run('status')).toBe(EXIT.unreachable);
    expect(stderr()).toContain('No running Ninebrains Brain');
    expect(stderr()).toContain('gone.json');
  });

  it('prints help with no arguments, but exits 2 because nothing was asked for', async () => {
    expect(await run('')).toBe(EXIT.usage);
    expect(stdout()).toContain('brain <command>');
    expect(await run('--help')).toBe(EXIT.ok);
  });
});

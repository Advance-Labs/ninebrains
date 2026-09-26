import { Console } from 'node:console';
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
import { render } from 'ink';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect } from '../src/connect';
import { App } from '../src/tui/app';
import { BrainStoreProvider } from '../src/tui/store';

const BRAIN_IDENTITY = { role: 'brain', brainId: 'main' } as const;

let server: BrainHttpServer;
let userData: string;
let env: NodeJS.ProcessEnv;

function fakeHost(): BrainHostOps {
  return {
    listDone: () => Promise.resolve([]),
    listNotes: () => Promise.resolve([]),
    dispatcherStatus: () =>
      Promise.resolve({
        paused: false,
        stopLatched: false,
        laneModes: {},
        activeRuns: 0,
        gatesConnected: true,
        unattendedBudgets: {},
      }),
    setDispatcherPaused: () => Promise.resolve(null),
    setLaneMode: () => Promise.resolve(null),
    listSessions: () => Promise.resolve([]),
    startBrain: () => Promise.resolve({ brainId: 'hub-1' }),
    stopBrain: () => Promise.resolve(null),
    stopAll: () => Promise.resolve({ killedRuns: 0, stoppedLanes: 0 }),
    clearStop: () => Promise.resolve(null),
  };
}

beforeEach(async () => {
  const store = new InMemoryBrainStore();
  const brain = new Brain({ store, resolveGateFloor: () => [] });
  brain.upsertLane(BRAIN_IDENTITY, {
    id: 'A',
    projectId: 'alpha',
    provider: 'claude',
    status: 'idle',
  });
  brain.createJob(BRAIN_IDENTITY, { projectId: 'alpha', title: 'Test job' });
  server = await startBrainHttpServer({ brain, host: fakeHost() });
  const token = server.issueToken({
    identity: { role: 'brain', brainId: USER_BRAIN_ID },
    projectId: null,
    attachmentRoots: [],
    user: true,
  });
  userData = mkdtempSync(path.join(tmpdir(), 'brain-tui-test-'));
  const file = brainHandshakePath(userData);
  writeBrainHandshake({ url: server.url, token, pid: process.pid, startedAt: Date.now() }, file);
  env = { NINEBRAINS_BRAIN_HANDSHAKE: file, NINEBRAINS_PROJECT: 'alpha' };
});

afterEach(async () => {
  await server.close();
  rmSync(userData, { recursive: true, force: true });
});

// Vitest replaces the global console; patch-console (used by Ink) needs Console.
if (!globalThis.console.Console) {
  (globalThis.console as unknown as { Console: typeof Console }).Console = Console;
}

describe('brain TUI', () => {
  it('renders the dashboard and loads data from the endpoint', async () => {
    const connection = connect(env);
    if (!connection.ok) throw new Error(connection.message);

    const lines: string[] = [];
    const mockStdout = Object.create(process.stdout);
    const originalWrite = process.stdout.write.bind(process.stdout);
    mockStdout.write = (chunk: string | Uint8Array, _encoding?: string, _cb?: () => void) => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return originalWrite(chunk);
    };
    mockStdout.columns = 120;
    mockStdout.rows = 40;
    mockStdout.isTTY = true;

    const mockStdin = Object.create(process.stdin);
    mockStdin.isTTY = true;
    mockStdin.setRawMode = () => mockStdin;
    mockStdin.on = () => mockStdin;
    mockStdin.off = () => mockStdin;
    mockStdin.pause = () => mockStdin;
    mockStdin.resume = () => mockStdin;

    const instance = render(
      React.createElement(
        BrainStoreProvider,
        { client: connection.connection.client, projectId: env.NINEBRAINS_PROJECT },
        React.createElement(App)
      ),
      {
        stdout: mockStdout as unknown as NodeJS.WriteStream,
        stdin: mockStdin as unknown as NodeJS.ReadStream,
      }
    );

    // Wait for initial data load
    await new Promise((r) => setTimeout(r, 1500));

    const output = lines.join('');
    expect(output).toContain('Ninebrains Brain');
    expect(output).toContain('Dashboard');
    expect(output).toContain('Test job');
    expect(output).toContain('claude');
    expect(output).toContain('Dispatching');

    instance.unmount();
  });
});

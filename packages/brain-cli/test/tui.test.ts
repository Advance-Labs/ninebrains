import { Console } from 'node:console';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
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
  // beta has a ready job and no lane at all: the TUI must say why it is not moving.
  brain.createJob(BRAIN_IDENTITY, { projectId: 'beta', title: 'Stuck job' });
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

async function renderTui(project: string, columns: number): Promise<string[]> {
  const connection = connect({ ...env, NINEBRAINS_PROJECT: project });
  if (!connection.ok) throw new Error(connection.message);

  const chunks: string[] = [];
  const mockStdout = Object.create(process.stdout);
  mockStdout.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  mockStdout.columns = columns;
  mockStdout.rows = 30;
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
      { client: connection.connection.client, projectId: project },
      React.createElement(App)
    ),
    {
      stdout: mockStdout as unknown as NodeJS.WriteStream,
      stdin: mockStdin as unknown as NodeJS.ReadStream,
      // Ink only writes dynamic frames to stdout while interactive, and it treats a CI
      // environment as non-interactive (isInCi in ink/build/ink.js) regardless of isTTY,
      // buffering the frame until unmount. debug mode writes every frame synchronously, so the
      // assertions below see the rendered output in both environments.
      debug: true,
    }
  );
  // The first poll lands, then the next frame renders it.
  await new Promise((r) => setTimeout(r, 1000));
  instance.unmount();
  // Each debug write is one whole frame with no trailing newline, so split frames apart first.
  return chunks.flatMap((chunk) => stripVTControlCharacters(chunk).split('\n'));
}

describe('brain TUI', () => {
  it.each([80, 160])(
    'renders header, feed, prompt and status line within %i columns',
    async (columns) => {
      const lines = await renderTui('alpha', columns);
      const output = lines.join('\n');

      expect(output).toContain('Ninebrains Brain · alpha');
      expect(output).toContain('● dispatching');
      expect(output).toContain('connected · 1 jobs · claude-A');
      expect(output).toContain('/new, /send, /jobs');
      expect(output).toContain('1 ready · 0 active · 0 blocked');
      expect(output).toContain('lanes 1 live · 1 idle');
      // No boxed panels and no wrapping: every line fits the terminal.
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(columns);
    }
  );

  it('says why a ready job is not moving', async () => {
    const output = (await renderTui('beta', 120)).join('\n');
    expect(output).toContain('no lanes: add one in the Lanes grid');
  });
});

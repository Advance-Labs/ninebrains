import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import { afterAll, describe, expect, it } from 'vitest';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import { APP_IDENTITY, Dispatcher } from './dispatcher';
import { stopEverything } from './stop';

const FAKE_CLAUDE = fileURLToPath(
  new URL('../../../../../../../tooling/fake-agent/bin/fake-claude.mjs', import.meta.url)
);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-stop-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function sleepingClaude(): string {
  const path = join(root, `claude-${randomUUID()}.sh`);
  const script = JSON.stringify([{ sleep: 60_000 }]);
  writeFileSync(
    path,
    `#!/bin/sh\nexport FAKE_AGENT_SCRIPT='${script}'\nexec '${process.execPath}' '${FAKE_CLAUDE}' "$@"\n`
  );
  chmodSync(path, 0o755);
  return path;
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('SEC-30 global STOP', () => {
  it('kills runs, latches dispatch and answers inside 5 s even when a lane stop hangs', async () => {
    const worktree = join(root, 'wt', 'lane-1');
    mkdirSync(worktree, { recursive: true });
    const supervisor = new ExecRunSupervisor({
      userDataDir: join(root, 'userData'),
      resolveBinary: async () => sleepingClaude(),
      allowedRoots: () => [join(root, 'wt')],
      maxConcurrentRuns: 4,
    });
    const runs = [1, 2].map(() =>
      supervisor.run({
        runId: `run-${randomUUID().slice(0, 8)}`,
        provider: 'claude',
        preset: 'worker',
        cwd: worktree,
        prompt: 'sleep',
        budgets: { wallClockMs: 60_000 },
      })
    );
    await until(() => supervisor.activeRunIds.length === 2);

    const brain = new Brain({ store: new InMemoryBrainStore() });
    brain.upsertLane(APP_IDENTITY, { id: 'L', projectId: 'p1', provider: 'claude', status: 'idle' });
    brain.createJob(APP_IDENTITY, { projectId: 'p1', title: 'must not dispatch' });
    const dispatcher = new Dispatcher({
      brain,
      lanes: () => [],
      paste: async () => 'pasted',
      runUnattended: async () => {},
      onError: () => {},
    });

    const stoppedLanes: string[] = [];
    const started = Date.now();
    const result = await stopEverything({
      latch: () => dispatcher.latch(),
      killAllRuns: () => supervisor.killAll(),
      activeRunCount: () => supervisor.activeRunIds.length,
      dispatchedAttendedLanes: () => ['lane-1'],
      // A wedged PTY stop must not hold STOP past its deadline.
      stopLane: (laneId) => {
        stoppedLanes.push(laneId);
        return new Promise<void>(() => {});
      },
      onError: () => {},
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5_000);
    expect(result).toMatchObject({ killedRuns: 2, stoppedLanes: 1, timedOut: true });
    expect(stoppedLanes).toEqual(['lane-1']);
    expect(supervisor.activeRunIds).toEqual([]);
    for (const run of await Promise.all(runs)) expect(run.reason).toBe('killed');

    // Latched: no new runs and no dispatch until cleared.
    expect(dispatcher.state.stopLatched).toBe(true);
    expect(await dispatcher.tick()).toEqual([]);
    await expect(
      supervisor.run({
        runId: 'after-stop',
        provider: 'claude',
        preset: 'worker',
        cwd: worktree,
        prompt: 'x',
        budgets: { wallClockMs: 1_000 },
      })
    ).rejects.toThrow(/stop-latched/);
  }, 15_000);
});

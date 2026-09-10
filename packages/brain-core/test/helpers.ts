import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { Brain } from '../src/brain/brain';
import { InMemoryBrainStore } from '../src/store/memory-store';
import { SqliteBrainStore } from '../src/store/sqlite/sqlite-store';
import type { BrainStore } from '../src/store/store';
import type { Identity, Lane } from '../src/types';

export const BRAIN: Identity = { role: 'brain', brainId: 'main' };
export const LANE_A: Identity = { role: 'lane', laneId: 'A', projectId: 'p1' };
export const LANE_B: Identity = { role: 'lane', laneId: 'B', projectId: 'p1' };
export const LANE_X: Identity = { role: 'lane', laneId: 'X', projectId: 'p2' };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

export function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'brain-core-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export type StoreFactory = () => BrainStore;

/** Run a suite against both store implementations. */
export const STORES: Array<[string, StoreFactory]> = [
  ['memory', () => new InMemoryBrainStore()],
  [
    'sqlite',
    () => {
      const store = SqliteBrainStore.open(tempDir());
      cleanups.unshift(() => store.close());
      return store;
    },
  ],
];

/** A Brain with a deterministic clock and ids, plus lanes A, B (p1) and X (p2). */
export function makeBrain(store: BrainStore, options: { lanes?: boolean } = {}): Brain {
  let clock = 1_000;
  let seq = 0;
  const brain = new Brain({ store, now: () => ++clock, newId: () => `id-${++seq}` });
  if (options.lanes !== false) {
    const lanes: Array<Pick<Lane, 'id' | 'projectId' | 'provider' | 'status'>> = [
      { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' },
      { id: 'B', projectId: 'p1', provider: 'codex', status: 'idle' },
      { id: 'X', projectId: 'p2', provider: 'claude', status: 'idle' },
    ];
    for (const lane of lanes) brain.upsertLane(BRAIN, lane);
  }
  return brain;
}

/** Drives a ready task all the way to done through lane `lane`. */
export function finish(brain: Brain, lane: Identity, taskId: string): void {
  brain.claimTask(lane, taskId, { start: true });
  brain.completeTask(lane, taskId, { summary: `did ${taskId}` });
  brain.recordGateResult(BRAIN, taskId, { pass: true });
}

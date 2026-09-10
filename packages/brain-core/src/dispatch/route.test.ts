import { describe, expect, it } from 'vitest';
import type { Edge, Lane, Run } from '../types';
import { type RoutableTask, pickLane } from './route';

const lane = (id: string, overrides: Partial<Lane> = {}): Lane => ({
  id,
  projectId: 'p1',
  provider: 'claude',
  status: 'idle',
  recentFiles: [],
  activeTaskId: null,
  updatedAt: 0,
  ...overrides,
});

const task = (overrides: Partial<RoutableTask> = {}): RoutableTask => ({
  id: 't',
  projectId: 'p1',
  hints: {},
  ...overrides,
});

let runSeq = 0;
const run = (laneId: string, taskId = 'old', startedAt = ++runSeq): Run => ({
  id: `r${runSeq}`,
  taskId,
  laneId,
  mode: 'attended',
  startedAt,
  endedAt: null,
  exitCode: null,
  transcriptPath: null,
});

const edge = (from: string, to: string): Edge => ({ from, to, projectId: 'p1', planId: null, createdAt: 0 });

describe('pickLane', () => {
  it('returns null when no lane is idle in the task project', () => {
    expect(pickLane(task(), [], { runs: [] })).toBeNull();
    const lanes = [lane('busy', { status: 'running' }), lane('asleep', { status: 'asleep' }), lane('far', { projectId: 'p2' })];
    expect(pickLane(task(), lanes, { runs: [] })).toBeNull();
  });

  it('ignores non-idle and other-project lanes', () => {
    const lanes = [lane('busy', { status: 'verifying' }), lane('far', { projectId: 'p2' }), lane('free')];
    expect(pickLane(task(), lanes, { runs: [] })).toBe('free');
  });

  it('prefers the lane that recently touched the task files, even if it is busier', () => {
    const lanes = [lane('fresh'), lane('warm', { recentFiles: ['src/auth/login.ts', 'README.md'] })];
    const history = { runs: [run('warm'), run('warm'), run('warm')] };
    expect(pickLane(task({ hints: { paths: ['src/auth/login.ts'] } }), lanes, history)).toBe('warm');
  });

  it('matches directories against files inside them, in both directions', () => {
    const lanes = [lane('a'), lane('b', { recentFiles: ['./src/auth/login.ts'] })];
    expect(pickLane(task({ hints: { paths: ['src/auth/'] } }), lanes, { runs: [] })).toBe('b');
    const dirLanes = [lane('a'), lane('b', { recentFiles: ['src/auth'] })];
    expect(pickLane(task({ hints: { paths: ['src\\auth\\session.ts'] } }), dirLanes, { runs: [] })).toBe('b');
    expect(pickLane(task({ hints: { paths: ['src/authz.ts'] } }), dirLanes, { runs: [] })).toBe('a');
  });

  it('prefers the lane whose last task is in the dependency chain', () => {
    const lanes = [lane('a'), lane('b')];
    const history = {
      runs: [run('b', 'unrelated', 1), run('b', 'schema', 5), run('a', 'other', 3)],
      edges: [edge('schema', 'migrate'), edge('migrate', 't')],
    };
    expect(pickLane(task(), lanes, history)).toBe('b');
  });

  it('only counts the lane\'s most recent task for chain affinity', () => {
    const lanes = [lane('a'), lane('b')];
    const history = {
      runs: [run('b', 'schema', 1), run('b', 'unrelated', 9), run('a', 'x', 2), run('a', 'y', 3)],
      edges: [edge('schema', 't')],
    };
    // b's last task is unrelated, so it falls back to load: a has 2 runs, b has 2; tie -> id.
    expect(pickLane(task(), lanes, history)).toBe('a');
  });

  it('falls back to the least-loaded lane', () => {
    const lanes = [lane('a'), lane('b'), lane('c')];
    const history = { runs: [run('a'), run('a'), run('b'), run('c'), run('c')] };
    expect(pickLane(task(), lanes, history)).toBe('b');
  });

  it('breaks ties by lane id so the choice is deterministic', () => {
    expect(pickLane(task(), [lane('m'), lane('c'), lane('x')], { runs: [] })).toBe('c');
  });

  it('routes review tasks to a different provider than the author when possible', () => {
    const lanes = [
      lane('claude-warm', { provider: 'claude', recentFiles: ['src/a.ts'] }),
      lane('codex-cold', { provider: 'codex' }),
    ];
    const review = task({ hints: { kind: 'review', authorProvider: 'claude', paths: ['src/a.ts'] } });
    expect(pickLane(review, lanes, { runs: [] })).toBe('codex-cold');
  });

  it('falls back to the same provider for review when no other is free', () => {
    const lanes = [lane('c1', { provider: 'claude' }), lane('x1', { provider: 'codex', status: 'running' })];
    const review = task({ hints: { kind: 'review', authorProvider: 'claude' } });
    expect(pickLane(review, lanes, { runs: [] })).toBe('c1');
  });

  it('does not apply the provider rule to work tasks', () => {
    const lanes = [lane('a', { provider: 'claude' }), lane('b', { provider: 'codex' })];
    expect(pickLane(task({ hints: { authorProvider: 'claude' } }), lanes, { runs: [] })).toBe('a');
  });
});

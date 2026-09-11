import { describe, expect, it } from 'vitest';
import type { JobEdge, Lane, Run } from '../types';
import { type RoutableJob, pickLane } from './route';

const lane = (id: string, overrides: Partial<Lane> = {}): Lane => ({
  id,
  projectId: 'p1',
  provider: 'claude',
  status: 'idle',
  recentFiles: [],
  activeJobId: null,
  updatedAt: 0,
  ...overrides,
});

const job = (overrides: Partial<RoutableJob> = {}): RoutableJob => ({
  id: 't',
  projectId: 'p1',
  hints: {},
  ...overrides,
});

let runSeq = 0;
const run = (laneId: string, jobId = 'old', startedAt = ++runSeq): Run => ({
  id: `r${runSeq}`,
  jobId,
  laneId,
  mode: 'attended',
  startedAt,
  endedAt: null,
  exitCode: null,
  transcriptPath: null,
});

const edge = (from: string, to: string): JobEdge => ({
  from,
  to,
  projectId: 'p1',
  planId: null,
  createdAt: 0,
});

describe('pickLane', () => {
  it('returns null when no lane is idle in the job project', () => {
    expect(pickLane(job(), [], { runs: [] })).toBeNull();
    const lanes = [
      lane('busy', { status: 'running' }),
      lane('asleep', { status: 'asleep' }),
      lane('far', { projectId: 'p2' }),
    ];
    expect(pickLane(job(), lanes, { runs: [] })).toBeNull();
  });

  it('ignores non-idle and other-project lanes', () => {
    const lanes = [
      lane('busy', { status: 'verifying' }),
      lane('far', { projectId: 'p2' }),
      lane('free'),
    ];
    expect(pickLane(job(), lanes, { runs: [] })).toBe('free');
  });

  it('prefers the lane that recently touched the job files, even if it is busier', () => {
    const lanes = [
      lane('fresh'),
      lane('warm', { recentFiles: ['src/auth/login.ts', 'README.md'] }),
    ];
    const history = { runs: [run('warm'), run('warm'), run('warm')] };
    expect(pickLane(job({ hints: { paths: ['src/auth/login.ts'] } }), lanes, history)).toBe('warm');
  });

  it('matches directories against files inside them, in both directions', () => {
    const lanes = [lane('a'), lane('b', { recentFiles: ['./src/auth/login.ts'] })];
    expect(pickLane(job({ hints: { paths: ['src/auth/'] } }), lanes, { runs: [] })).toBe('b');
    const dirLanes = [lane('a'), lane('b', { recentFiles: ['src/auth'] })];
    expect(
      pickLane(job({ hints: { paths: ['src\\auth\\session.ts'] } }), dirLanes, { runs: [] })
    ).toBe('b');
    expect(pickLane(job({ hints: { paths: ['src/authz.ts'] } }), dirLanes, { runs: [] })).toBe('a');
  });

  it('prefers the lane whose last job is in the dependency chain', () => {
    const lanes = [lane('a'), lane('b')];
    const history = {
      runs: [run('b', 'unrelated', 1), run('b', 'schema', 5), run('a', 'other', 3)],
      edges: [edge('schema', 'migrate'), edge('migrate', 't')],
    };
    expect(pickLane(job(), lanes, history)).toBe('b');
  });

  it("only counts the lane's most recent job for chain affinity", () => {
    const lanes = [lane('a'), lane('b')];
    const history = {
      runs: [run('b', 'schema', 1), run('b', 'unrelated', 9), run('a', 'x', 2), run('a', 'y', 3)],
      edges: [edge('schema', 't')],
    };
    // b's last job is unrelated, so it falls back to load: a has 2 runs, b has 2; tie -> id.
    expect(pickLane(job(), lanes, history)).toBe('a');
  });

  it('falls back to the least-loaded lane', () => {
    const lanes = [lane('a'), lane('b'), lane('c')];
    const history = { runs: [run('a'), run('a'), run('b'), run('c'), run('c')] };
    expect(pickLane(job(), lanes, history)).toBe('b');
  });

  it('breaks ties by lane id so the choice is deterministic', () => {
    expect(pickLane(job(), [lane('m'), lane('c'), lane('x')], { runs: [] })).toBe('c');
  });

  it('routes review jobs to a different provider than the author when possible', () => {
    const lanes = [
      lane('claude-warm', { provider: 'claude', recentFiles: ['src/a.ts'] }),
      lane('codex-cold', { provider: 'codex' }),
    ];
    const review = job({
      hints: { kind: 'review', authorProvider: 'claude', paths: ['src/a.ts'] },
    });
    expect(pickLane(review, lanes, { runs: [] })).toBe('codex-cold');
  });

  it('falls back to the same provider for review when no other is free', () => {
    const lanes = [
      lane('c1', { provider: 'claude' }),
      lane('x1', { provider: 'codex', status: 'running' }),
    ];
    const review = job({ hints: { kind: 'review', authorProvider: 'claude' } });
    expect(pickLane(review, lanes, { runs: [] })).toBe('c1');
  });

  it('does not apply the provider rule to work jobs', () => {
    const lanes = [lane('a', { provider: 'claude' }), lane('b', { provider: 'codex' })];
    expect(pickLane(job({ hints: { authorProvider: 'claude' } }), lanes, { runs: [] })).toBe('a');
  });
});

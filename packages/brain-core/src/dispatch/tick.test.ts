import { describe, expect, it } from 'vitest';
import { BRAIN, STORES, makeBrain } from '../../test/helpers';
import type { Lane, Job } from '../types';
import { dispatchTick } from './tick';

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

const job = (id: string, createdAt: number, overrides: Partial<Job> = {}): Job => ({
  id,
  projectId: 'p1',
  title: id,
  body: '',
  state: 'ready',
  laneId: null,
  attempts: 0,
  gateSpec: null,
  hints: {},
  result: null,
  reason: null,
  createdBy: { kind: 'brain', id: 'main' },
  planId: null,
  planNodeId: null,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

describe('dispatchTick', () => {
  it('assigns the oldest ready jobs first, one per idle lane', () => {
    const plan = dispatchTick({
      jobs: [job('new', 30), job('old', 10), job('mid', 20)],
      edges: [],
      lanes: [lane('a'), lane('b')],
      runs: [],
    });
    expect(plan).toEqual([
      { jobId: 'old', laneId: 'a' },
      { jobId: 'mid', laneId: 'b' },
    ]);
  });

  it('skips jobs that are not ready or are archived', () => {
    const plan = dispatchTick({
      jobs: [
        job('p', 1, { state: 'proposed' }),
        job('r', 2, { state: 'running' }),
        job('gone', 3, { archivedAt: 5 }),
        job('ok', 4),
      ],
      edges: [],
      lanes: [lane('a'), lane('b')],
      runs: [],
    });
    expect(plan).toEqual([{ jobId: 'ok', laneId: 'a' }]);
  });

  it('keeps going past a job no lane can take', () => {
    const plan = dispatchTick({
      jobs: [job('elsewhere', 1, { projectId: 'p2' }), job('here', 2)],
      edges: [],
      lanes: [lane('a')],
      runs: [],
    });
    expect(plan).toEqual([{ jobId: 'here', laneId: 'a' }]);
  });

  it('returns nothing without idle lanes', () => {
    expect(dispatchTick({ jobs: [job('t', 1)], edges: [], lanes: [lane('a', { status: 'running' })], runs: [] })).toEqual(
      []
    );
  });

  it('is pure: the input is not modified', () => {
    const state = { jobs: [job('t', 1)], edges: [], lanes: [lane('a')], runs: [] };
    const before = structuredClone(state);
    dispatchTick(state);
    expect(state).toEqual(before);
  });
});

describe.each(STORES)('Brain.planDispatch (%s store)', (_name, createStore) => {
  it('plans from a snapshot and the plan applies cleanly', () => {
    const brain = makeBrain(createStore());
    const first = brain.createJob(BRAIN, { projectId: 'p1', title: 'first' });
    const second = brain.createJob(BRAIN, { projectId: 'p1', title: 'second' });
    brain.createJob(BRAIN, { projectId: 'p1', title: 'third' });
    const plan = brain.planDispatch(BRAIN, { projectId: 'p1' });
    expect(plan).toEqual([
      { jobId: first.id, laneId: 'A' },
      { jobId: second.id, laneId: 'B' },
    ]);
    for (const step of plan) brain.assignJob(BRAIN, step.jobId, step.laneId);
    expect(brain.listJobs(BRAIN, { states: ['claimed'] })).toHaveLength(2);
  });
});

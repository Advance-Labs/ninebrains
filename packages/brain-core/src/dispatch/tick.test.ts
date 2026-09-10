import { describe, expect, it } from 'vitest';
import { BRAIN, STORES, makeBrain } from '../../test/helpers';
import type { Lane, Task } from '../types';
import { dispatchTick } from './tick';

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

const task = (id: string, createdAt: number, overrides: Partial<Task> = {}): Task => ({
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
  createdBy: 'brain:main',
  planId: null,
  planNodeId: null,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

describe('dispatchTick', () => {
  it('assigns the oldest ready tasks first, one per idle lane', () => {
    const plan = dispatchTick({
      tasks: [task('new', 30), task('old', 10), task('mid', 20)],
      edges: [],
      lanes: [lane('a'), lane('b')],
      runs: [],
    });
    expect(plan).toEqual([
      { taskId: 'old', laneId: 'a' },
      { taskId: 'mid', laneId: 'b' },
    ]);
  });

  it('skips tasks that are not ready or are archived', () => {
    const plan = dispatchTick({
      tasks: [
        task('p', 1, { state: 'proposed' }),
        task('r', 2, { state: 'running' }),
        task('gone', 3, { archivedAt: 5 }),
        task('ok', 4),
      ],
      edges: [],
      lanes: [lane('a'), lane('b')],
      runs: [],
    });
    expect(plan).toEqual([{ taskId: 'ok', laneId: 'a' }]);
  });

  it('keeps going past a task no lane can take', () => {
    const plan = dispatchTick({
      tasks: [task('elsewhere', 1, { projectId: 'p2' }), task('here', 2)],
      edges: [],
      lanes: [lane('a')],
      runs: [],
    });
    expect(plan).toEqual([{ taskId: 'here', laneId: 'a' }]);
  });

  it('returns nothing without idle lanes', () => {
    expect(dispatchTick({ tasks: [task('t', 1)], edges: [], lanes: [lane('a', { status: 'running' })], runs: [] })).toEqual(
      []
    );
  });

  it('is pure: the input is not modified', () => {
    const state = { tasks: [task('t', 1)], edges: [], lanes: [lane('a')], runs: [] };
    const before = structuredClone(state);
    dispatchTick(state);
    expect(state).toEqual(before);
  });
});

describe.each(STORES)('Brain.planDispatch (%s store)', (_name, createStore) => {
  it('plans from a snapshot and the plan applies cleanly', () => {
    const brain = makeBrain(createStore());
    const first = brain.createTask(BRAIN, { projectId: 'p1', title: 'first' });
    const second = brain.createTask(BRAIN, { projectId: 'p1', title: 'second' });
    brain.createTask(BRAIN, { projectId: 'p1', title: 'third' });
    const plan = brain.planDispatch(BRAIN, { projectId: 'p1' });
    expect(plan).toEqual([
      { taskId: first.id, laneId: 'A' },
      { taskId: second.id, laneId: 'B' },
    ]);
    for (const step of plan) brain.assignTask(BRAIN, step.taskId, step.laneId);
    expect(brain.listTasks(BRAIN, { states: ['claimed'] })).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, LANE_B, LANE_X, STORES, makeBrain } from '../../test/helpers';
import { ForbiddenError, NotFoundError } from '../errors';

describe.each(STORES)('lane-scoped authorization (%s store)', (_name, createStore) => {
  function setup() {
    const brain = makeBrain(createStore());
    const task = brain.createTask(BRAIN, { projectId: 'p1', title: 'Held by B' });
    brain.claimTask(LANE_B, task.id, { start: true });
    return { brain, task };
  }

  it("lane A cannot complete, block, start or release lane B's task", () => {
    const { brain, task } = setup();
    expect(() => brain.completeTask(LANE_A, task.id, { summary: 'mine now' })).toThrow(ForbiddenError);
    expect(() => brain.blockTask(LANE_A, task.id, 'nope')).toThrow(ForbiddenError);
    expect(() => brain.startTask(LANE_A, task.id)).toThrow(ForbiddenError);
    expect(() => brain.releaseTask(LANE_A, task.id)).toThrow(ForbiddenError);
    expect(brain.getTask(BRAIN, task.id)).toMatchObject({ state: 'running', laneId: 'B' });
  });

  it("lane A cannot read lane B's inbox; the brain can", () => {
    const { brain } = setup();
    brain.sendMessage(BRAIN, { to: 'lane:B', body: 'for B only' });
    expect(() => brain.readInbox(LANE_A, { address: 'lane:B' })).toThrow(ForbiddenError);
    expect(() => brain.readInbox(LANE_A, { address: 'brain:main' })).toThrow(ForbiddenError);
    expect(brain.readInbox(LANE_A)).toEqual([]);
    expect(brain.readInbox(BRAIN, { address: 'lane:B' }).map((m) => m.body)).toEqual(['for B only']);
  });

  it('a lane cannot see or claim tasks in another project', () => {
    const { brain } = setup();
    const foreign = brain.createTask(BRAIN, { projectId: 'p2', title: 'Other project' });
    expect(() => brain.claimTask(LANE_A, foreign.id)).toThrow(NotFoundError);
    expect(() => brain.getTask(LANE_A, foreign.id)).toThrow(NotFoundError);
    expect(brain.listTasks(LANE_A).map((t) => t.projectId)).toEqual(['p1']);
    expect(() => brain.listTasks(LANE_A, { projectId: 'p2' })).toThrow(ForbiddenError);
    expect(brain.listTasks(LANE_X).map((t) => t.id)).toEqual([foreign.id]);
    expect(() => brain.listLanes(LANE_A, { projectId: 'p2' })).toThrow(ForbiddenError);
    expect(brain.listLanes(LANE_A).map((l) => l.id)).toEqual(['A', 'B']);
  });

  it('lanes cannot perform brain operations', () => {
    const { brain, task } = setup();
    const other = brain.createTask(BRAIN, { projectId: 'p1', title: 'Other' });
    expect(() => brain.createTask(LANE_A, { projectId: 'p1', title: 'x' })).toThrow(ForbiddenError);
    expect(() => brain.linkTasks(LANE_A, task.id, other.id)).toThrow(ForbiddenError);
    expect(() => brain.unlinkTasks(LANE_A, task.id, other.id)).toThrow(ForbiddenError);
    expect(() => brain.assignTask(LANE_A, other.id, 'A')).toThrow(ForbiddenError);
    expect(() => brain.requeueTask(LANE_A, task.id)).toThrow(ForbiddenError);
    expect(() => brain.failTask(LANE_A, task.id, 'x')).toThrow(ForbiddenError);
    expect(() => brain.recordGateResult(LANE_B, task.id, { pass: true })).toThrow(ForbiddenError);
    expect(() => brain.broadcast(LANE_A, { projectId: 'p1', body: 'x' })).toThrow(ForbiddenError);
    expect(() => brain.upsertLane(LANE_A, { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' })).toThrow(
      ForbiddenError
    );
    expect(() => brain.startRun(LANE_A, { taskId: task.id, laneId: 'A', mode: 'attended' })).toThrow(ForbiddenError);
    expect(() => brain.listRuns(LANE_A)).toThrow(ForbiddenError);
    expect(() => brain.snapshot(LANE_A)).toThrow(ForbiddenError);
  });

  it('claiming is a lane action; the brain assigns instead', () => {
    const { brain } = setup();
    const task = brain.createTask(BRAIN, { projectId: 'p1', title: 'T' });
    expect(() => brain.claimTask(BRAIN, task.id)).toThrow(ForbiddenError);
    expect(brain.assignTask(BRAIN, task.id, 'A')).toMatchObject({ state: 'claimed', laneId: 'A' });
  });

  it('the brain cannot assign a task to a lane of another project or an unknown lane', () => {
    const { brain } = setup();
    const task = brain.createTask(BRAIN, { projectId: 'p1', title: 'T' });
    expect(() => brain.assignTask(BRAIN, task.id, 'X')).toThrow(ForbiddenError);
    expect(() => brain.assignTask(BRAIN, task.id, 'ghost')).toThrow(NotFoundError);
  });

  it('the brain can act on any task', () => {
    const { brain, task } = setup();
    expect(brain.completeTask(BRAIN, task.id, { summary: 'brain override' }).state).toBe('verifying');
    expect(brain.blockTask(BRAIN, task.id, 'stop').state).toBe('blocked');
    expect(brain.requeueTask(BRAIN, task.id).state).toBe('ready');
  });

  it('a lane cannot message lanes of another project, or note on their tasks', () => {
    const { brain } = setup();
    const foreign = brain.createTask(BRAIN, { projectId: 'p2', title: 'F' });
    expect(() => brain.sendMessage(LANE_A, { to: 'lane:X', body: 'hello' })).toThrow(ForbiddenError);
    expect(() => brain.addNote(LANE_A, { body: 'n', taskId: foreign.id })).toThrow(NotFoundError);
    expect(brain.sendMessage(LANE_A, { to: 'lane:B', body: 'hello' }).from).toBe('lane:A');
    expect(brain.sendMessage(LANE_A, { to: 'brain:main', body: 'status' }).to).toBe('brain:main');
  });
});

import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, LANE_B, LANE_X, STORES, makeBrain } from '../../test/helpers';
import { ForbiddenError, NotFoundError } from '../errors';

describe.each(STORES)('lane-scoped authorization (%s store)', (_name, createStore) => {
  function setup() {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'Held by B' });
    brain.claimJob(LANE_B, job.id, { start: true });
    return { brain, job };
  }

  it("lane A cannot complete, block, start or release lane B's job", () => {
    const { brain, job } = setup();
    expect(() => brain.completeJob(LANE_A, job.id, { summary: 'mine now' })).toThrow(ForbiddenError);
    expect(() => brain.blockJob(LANE_A, job.id, 'nope')).toThrow(ForbiddenError);
    expect(() => brain.startJob(LANE_A, job.id)).toThrow(ForbiddenError);
    expect(() => brain.releaseJob(LANE_A, job.id)).toThrow(ForbiddenError);
    expect(brain.getJob(BRAIN, job.id)).toMatchObject({ state: 'running', laneId: 'B' });
  });

  it("lane A cannot read lane B's inbox; the brain can", () => {
    const { brain } = setup();
    brain.sendMessage(BRAIN, { to: 'lane:B', body: 'for B only' });
    expect(() => brain.readInbox(LANE_A, { address: 'lane:B' })).toThrow(ForbiddenError);
    expect(() => brain.readInbox(LANE_A, { address: 'brain:main' })).toThrow(ForbiddenError);
    expect(brain.readInbox(LANE_A)).toEqual([]);
    expect(brain.readInbox(BRAIN, { address: 'lane:B' }).map((m) => m.body)).toEqual(['for B only']);
  });

  it('a lane cannot see or claim jobs in another project', () => {
    const { brain } = setup();
    const foreign = brain.createJob(BRAIN, { projectId: 'p2', title: 'Other project' });
    expect(() => brain.claimJob(LANE_A, foreign.id)).toThrow(NotFoundError);
    expect(() => brain.getJob(LANE_A, foreign.id)).toThrow(NotFoundError);
    expect(brain.listJobs(LANE_A).map((t) => t.projectId)).toEqual(['p1']);
    expect(() => brain.listJobs(LANE_A, { projectId: 'p2' })).toThrow(ForbiddenError);
    expect(brain.listJobs(LANE_X).map((t) => t.id)).toEqual([foreign.id]);
    expect(() => brain.listLanes(LANE_A, { projectId: 'p2' })).toThrow(ForbiddenError);
    expect(brain.listLanes(LANE_A).map((l) => l.id)).toEqual(['A', 'B']);
  });

  it('lanes cannot perform brain operations', () => {
    const { brain, job } = setup();
    const other = brain.createJob(BRAIN, { projectId: 'p1', title: 'Other' });
    expect(() => brain.createJob(LANE_A, { projectId: 'p1', title: 'x' })).toThrow(ForbiddenError);
    expect(() => brain.linkJobs(LANE_A, job.id, other.id)).toThrow(ForbiddenError);
    expect(() => brain.unlinkJobs(LANE_A, job.id, other.id)).toThrow(ForbiddenError);
    expect(() => brain.assignJob(LANE_A, other.id, 'A')).toThrow(ForbiddenError);
    expect(() => brain.requeueJob(LANE_A, job.id)).toThrow(ForbiddenError);
    expect(() => brain.failJob(LANE_A, job.id, 'x')).toThrow(ForbiddenError);
    expect(() => brain.recordGateResult(LANE_B, job.id, { pass: true })).toThrow(ForbiddenError);
    expect(() => brain.broadcast(LANE_A, { projectId: 'p1', body: 'x' })).toThrow(ForbiddenError);
    expect(() => brain.upsertLane(LANE_A, { id: 'A', projectId: 'p1', provider: 'claude', status: 'idle' })).toThrow(
      ForbiddenError
    );
    expect(() => brain.startRun(LANE_A, { jobId: job.id, laneId: 'A', mode: 'attended' })).toThrow(ForbiddenError);
    expect(() => brain.listRuns(LANE_A)).toThrow(ForbiddenError);
    expect(() => brain.snapshot(LANE_A)).toThrow(ForbiddenError);
  });

  it('claiming is a lane action; the brain assigns instead', () => {
    const { brain } = setup();
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    expect(() => brain.claimJob(BRAIN, job.id)).toThrow(ForbiddenError);
    expect(brain.assignJob(BRAIN, job.id, 'A')).toMatchObject({ state: 'claimed', laneId: 'A' });
  });

  it('the brain cannot assign a job to a lane of another project or an unknown lane', () => {
    const { brain } = setup();
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    expect(() => brain.assignJob(BRAIN, job.id, 'X')).toThrow(ForbiddenError);
    expect(() => brain.assignJob(BRAIN, job.id, 'ghost')).toThrow(NotFoundError);
  });

  it('the brain can act on any job', () => {
    const { brain, job } = setup();
    expect(brain.completeJob(BRAIN, job.id, { summary: 'brain override' }).state).toBe('verifying');
    expect(brain.blockJob(BRAIN, job.id, 'stop').state).toBe('blocked');
    expect(brain.requeueJob(BRAIN, job.id).state).toBe('ready');
  });

  it('a lane cannot message lanes of another project, or note on their jobs', () => {
    const { brain } = setup();
    const foreign = brain.createJob(BRAIN, { projectId: 'p2', title: 'F' });
    expect(() => brain.sendMessage(LANE_A, { to: 'lane:X', body: 'hello' })).toThrow(ForbiddenError);
    expect(() => brain.addNote(LANE_A, { body: 'n', jobId: foreign.id })).toThrow(NotFoundError);
    expect(brain.sendMessage(LANE_A, { to: 'lane:B', body: 'hello' }).from).toBe('lane:A');
    expect(brain.sendMessage(LANE_A, { to: 'brain:main', body: 'status' }).to).toBe('brain:main');
  });
});

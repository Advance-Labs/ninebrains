import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, LANE_B, STORES, finish, makeBrain } from '../../test/helpers';
import { CycleError, IllegalTransitionError, InvalidInputError } from '../errors';
import type { BrainEventMap } from '../events';
import { Brain } from './brain';

describe.each(STORES)('job lifecycle (%s store)', (_name, createStore) => {
  it('creates jobs as ready when they have no dependencies, proposed otherwise', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B', dependsOn: [a.id] });
    expect(a.state).toBe('ready');
    expect(b.state).toBe('proposed');
    expect(a.createdBy).toEqual({ kind: 'brain', id: 'main' });
    expect(brain.listEdges(BRAIN, { projectId: 'p1' })).toMatchObject([{ from: a.id, to: b.id }]);
  });

  it('walks the happy path claimed -> running -> verifying -> done and logs it', () => {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'Ship it', gateSpec: { gates: ['tests'] } });

    expect(brain.claimJob(LANE_A, job.id)).toMatchObject({ state: 'claimed', laneId: 'A' });
    expect(brain.store.getLane('A')?.activeJobId).toBe(job.id);
    expect(brain.startJob(LANE_A, job.id).state).toBe('running');
    const verifying = brain.completeJob(LANE_A, job.id, { summary: 'shipped', artifacts: ['out.png'] });
    expect(verifying).toMatchObject({ state: 'verifying', result: { summary: 'shipped', artifacts: ['out.png'] } });
    expect(brain.recordGateResult(BRAIN, job.id, { pass: true }).state).toBe('done');

    expect(brain.listDone(BRAIN, { projectId: 'p1' })).toMatchObject([
      { jobId: job.id, laneId: 'A', summary: 'shipped', artifacts: ['out.png'] },
    ]);
    expect(brain.store.getLane('A')?.activeJobId).toBeNull();
  });

  it('promotes a dependent only when every inbound source is done', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B' });
    const c = brain.createJob(BRAIN, { projectId: 'p1', title: 'C', dependsOn: [a.id, b.id] });
    const d = brain.createJob(BRAIN, { projectId: 'p1', title: 'D', dependsOn: [c.id] });

    finish(brain, LANE_A, a.id);
    expect(brain.getJob(BRAIN, c.id).state).toBe('proposed');
    finish(brain, LANE_B, b.id);
    expect(brain.getJob(BRAIN, c.id).state).toBe('ready');
    // Promotion is one hop: D waits for C.
    expect(brain.getJob(BRAIN, d.id).state).toBe('proposed');
    finish(brain, LANE_A, c.id);
    expect(brain.getJob(BRAIN, d.id).state).toBe('ready');
  });

  it('rejects illegal moves with typed errors', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B', dependsOn: [a.id] });

    expect(() => brain.claimJob(LANE_A, b.id)).toThrow(IllegalTransitionError);
    brain.claimJob(LANE_A, a.id);
    expect(() => brain.claimJob(LANE_B, a.id)).toThrow(IllegalTransitionError);
    expect(() => brain.completeJob(LANE_A, a.id, { summary: 'x' })).toThrow(IllegalTransitionError);
    expect(() => brain.recordGateResult(BRAIN, a.id, { pass: true })).toThrow(IllegalTransitionError);
    expect(() => brain.requeueJob(BRAIN, a.id)).toThrow(IllegalTransitionError);
  });

  it('sends a failing job back to running, then blocks it at the third failure', () => {
    const brain = makeBrain(createStore());
    const blockedEvents: Array<BrainEventMap['jobBlocked']> = [];
    brain.events.on('jobBlocked', (event) => blockedEvents.push(event));
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'Flaky' });
    brain.claimJob(LANE_A, job.id, { start: true });

    for (const attempt of [1, 2]) {
      brain.completeJob(LANE_A, job.id, { summary: `try ${attempt}` });
      const back = brain.recordGateResult(BRAIN, job.id, { pass: false, feedback: `broken ${attempt}` });
      expect(back).toMatchObject({ state: 'running', attempts: attempt });
    }
    brain.completeJob(LANE_A, job.id, { summary: 'try 3' });
    const blocked = brain.recordGateResult(BRAIN, job.id, { pass: false, feedback: 'still broken' });

    expect(blocked).toMatchObject({ state: 'blocked', attempts: 3 });
    expect(blocked.reason).toContain('still broken');
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0]!.job.id).toBe(job.id);

    const inbox = brain.readInbox(LANE_A);
    expect(inbox.map((m) => m.body.split('\n')[1])).toEqual(['broken 1', 'broken 2', 'still broken']);
    expect(inbox[2]!.body).toContain('attempt 3/3');
  });

  it('requeues a blocked job with a fresh attempt budget', () => {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    brain.claimJob(LANE_A, job.id, { start: true });
    brain.blockJob(LANE_A, job.id, 'need credentials');
    const requeued = brain.requeueJob(BRAIN, job.id);
    expect(requeued).toMatchObject({ state: 'ready', attempts: 0, laneId: null, reason: null, result: null });
    expect(brain.store.getLane('A')?.activeJobId).toBeNull();
  });

  it('requeues to proposed when a dependency is still open', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B' });
    brain.claimJob(LANE_A, b.id, { start: true });
    brain.linkJobs(BRAIN, a.id, b.id);
    brain.failJob(BRAIN, b.id, 'crashed');
    expect(brain.requeueJob(BRAIN, b.id).state).toBe('proposed');
  });

  it('releases an unstarted claim back to ready', () => {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    brain.claimJob(LANE_A, job.id);
    expect(brain.releaseJob(LANE_A, job.id)).toMatchObject({ state: 'ready', laneId: null });
  });

  it('demotes a ready job when an unmet dependency is linked, and is idempotent', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B' });
    brain.linkJobs(BRAIN, a.id, b.id);
    brain.linkJobs(BRAIN, a.id, b.id);
    expect(brain.getJob(BRAIN, b.id).state).toBe('proposed');
    expect(brain.listEdges(BRAIN)).toHaveLength(1);
    brain.unlinkJobs(BRAIN, a.id, b.id);
    expect(brain.getJob(BRAIN, b.id).state).toBe('ready');
  });

  it('rejects a link that would close a cycle, with the cycle path', () => {
    const brain = makeBrain(createStore());
    const a = brain.createJob(BRAIN, { projectId: 'p1', title: 'A' });
    const b = brain.createJob(BRAIN, { projectId: 'p1', title: 'B', dependsOn: [a.id] });
    const c = brain.createJob(BRAIN, { projectId: 'p1', title: 'C', dependsOn: [b.id] });
    let caught: unknown;
    try {
      brain.linkJobs(BRAIN, c.id, a.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CycleError);
    expect((caught as CycleError).path).toEqual([c.id, a.id, b.id, c.id]);
  });

  it('rolls back everything, including events, when an operation fails midway', () => {
    const brain = makeBrain(createStore());
    const other = brain.createJob(BRAIN, { projectId: 'p2', title: 'Other project' });
    const eventsBefore = brain.readEvents(0).length;
    const changed: string[] = [];
    brain.events.on('jobChanged', ({ job }) => changed.push(job.title));

    expect(() => brain.createJob(BRAIN, { projectId: 'p1', title: 'Doomed', dependsOn: [other.id] })).toThrow(
      InvalidInputError
    );
    expect(brain.listJobs(BRAIN).map((t) => t.title)).toEqual(['Other project']);
    expect(changed).toEqual([]);
    expect(brain.readEvents(0)).toHaveLength(eventsBefore);
  });

  it('validates titles and bodies', () => {
    const brain = makeBrain(createStore());
    expect(() => brain.createJob(BRAIN, { projectId: 'p1', title: '  ' })).toThrow(InvalidInputError);
    expect(() => brain.createJob(BRAIN, { projectId: 'p1', title: 'x'.repeat(201) })).toThrow(InvalidInputError);
    expect(() => brain.createJob(BRAIN, { projectId: 'p1', title: 'ok', body: 'é'.repeat(17_000) })).toThrow(
      InvalidInputError
    );
  });

  it('persists every committed event to the log in order', () => {
    const brain = makeBrain(createStore(), { lanes: false });
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    brain.sendMessage(BRAIN, { to: { kind: 'lane', id: 'A' }, body: 'hi' });
    const events = brain.readEvents(0);
    expect(events.map((e) => e.type)).toEqual(['jobChanged', 'jobChanged', 'messageSent']);
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((x, y) => x - y));
    expect(events[1]).toMatchObject({ payload: { job: { id: job.id, state: 'ready' }, previousState: 'proposed' } });
    expect(brain.readEvents(events[1]!.seq).map((e) => e.type)).toEqual(['messageSent']);
    expect(brain.readEvents(0, 1)).toHaveLength(1);
  });

  it('isolates listener failures from the operation', () => {
    const errors: unknown[] = [];
    const noisy = new Brain({ store: createStore(), onListenerError: (error) => errors.push(error) });
    noisy.events.on('jobChanged', () => {
      throw new Error('listener bug');
    });
    const job = noisy.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    expect(noisy.getJob(BRAIN, job.id).state).toBe('ready');
    expect(errors).toHaveLength(2);
  });

  it('records runs; starting a run moves a claimed job to running', () => {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'T' });
    brain.assignJob(BRAIN, job.id, 'B');
    const run = brain.startRun(BRAIN, { jobId: job.id, laneId: 'B', mode: 'unattended', transcriptPath: '/t.jsonl' });
    expect(brain.getJob(BRAIN, job.id)).toMatchObject({ state: 'running', laneId: 'B' });
    const ended = brain.endRun(BRAIN, run.id, { exitCode: 0 });
    expect(ended).toMatchObject({ exitCode: 0, transcriptPath: '/t.jsonl' });
    expect(ended.endedAt).not.toBeNull();
    expect(brain.listRuns(BRAIN, { laneId: 'B' })).toEqual([ended]);
  });
});

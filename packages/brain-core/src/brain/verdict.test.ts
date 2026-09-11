import { describe, expect, it } from 'vitest';
import { BRAIN, LANE_A, STORES, makeBrain } from '../../test/helpers';
import { IllegalTransitionError, InvalidInputError } from '../errors';
import { InMemoryBrainStore } from '../store/memory-store';
import type { GateSpec } from '../types';
import { Brain } from './brain';

describe.each(STORES)('gate verdicts (%s store)', (_name, createStore) => {
  function verifying() {
    const brain = makeBrain(createStore());
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 'Build the page' });
    brain.claimJob(LANE_A, job.id, { start: true });
    brain.completeJob(LANE_A, job.id, { summary: 'built', artifacts: ['page.html'] });
    return { brain, job };
  }

  it('passed: done with verified true, the attempt and the evidence path', () => {
    const { brain, job } = verifying();
    const done = brain.recordGateResult(BRAIN, job.id, {
      pass: true,
      status: 'passed',
      attempt: 1,
      evidencePath: '/ev/job/1/manifest.json',
    });
    expect(done.state).toBe('done');
    expect(brain.getJob(BRAIN, job.id).result).toMatchObject({
      summary: 'built',
      artifacts: ['page.html'],
      verification: {
        status: 'passed',
        verified: true,
        attempt: 1,
        evidencePath: '/ev/job/1/manifest.json',
      },
    });
  });

  it('unverified: leaves verifying for done but is never verified', () => {
    const { brain, job } = verifying();
    brain.recordGateResult(BRAIN, job.id, { pass: true, status: 'unverified', attempt: 1 });
    const stored = brain.getJob(BRAIN, job.id);
    expect(stored.state).toBe('done');
    expect(stored.result?.verification).toMatchObject({ status: 'unverified', verified: false });
  });

  it('failed: back to running, attempt counted, verdict kept, feedback in the inbox', () => {
    const { brain, job } = verifying();
    const back = brain.recordGateResult(BRAIN, job.id, {
      pass: false,
      status: 'failed',
      attempt: 1,
      feedback: 'console error at 390px',
    });
    expect(back).toMatchObject({ state: 'running', attempts: 1 });
    expect(back.result?.verification).toMatchObject({ status: 'failed', attempt: 1 });
    expect(brain.readInbox(LANE_A).map((m) => m.body)).toEqual([
      expect.stringContaining('console error at 390px'),
    ]);
  });

  it('a replayed verdict for an earlier attempt cannot count twice', () => {
    const { brain, job } = verifying();
    brain.recordGateResult(BRAIN, job.id, {
      pass: false,
      status: 'failed',
      attempt: 1,
      feedback: 'broken',
    });
    brain.completeJob(LANE_A, job.id, { summary: 'fixed' });
    // The runner crashed after recording attempt 1 and replays it: refused, nothing changes.
    expect(() =>
      brain.recordGateResult(BRAIN, job.id, { pass: false, status: 'failed', attempt: 1 })
    ).toThrow(IllegalTransitionError);
    expect(brain.getJob(BRAIN, job.id)).toMatchObject({ state: 'verifying', attempts: 1 });
    expect(brain.readInbox(LANE_A)).toHaveLength(1);
    brain.recordGateResult(BRAIN, job.id, { pass: true, status: 'passed', attempt: 2 });
    expect(brain.getJob(BRAIN, job.id).result?.verification?.attempt).toBe(2);
  });

  it('rejects a status that contradicts pass', () => {
    const { brain, job } = verifying();
    expect(() => brain.recordGateResult(BRAIN, job.id, { pass: true, status: 'failed' })).toThrow(
      InvalidInputError
    );
    expect(() =>
      brain.recordGateResult(BRAIN, job.id, { pass: false, status: 'unverified' })
    ).toThrow(InvalidInputError);
    expect(brain.getJob(BRAIN, job.id).state).toBe('verifying');
  });

  it('three failed verdicts block the job and keep the last verdict', () => {
    const { brain, job } = verifying();
    for (const attempt of [1, 2, 3]) {
      if (attempt > 1) brain.completeJob(LANE_A, job.id, { summary: `try ${attempt}` });
      brain.recordGateResult(BRAIN, job.id, { pass: false, status: 'failed', attempt });
    }
    const blocked = brain.getJob(BRAIN, job.id);
    expect(blocked).toMatchObject({ state: 'blocked', attempts: 3 });
    expect(blocked.result?.verification?.attempt).toBe(3);
  });
});

describe('gate floor resolver input', () => {
  it('receives the requested spec, so the app can read a gate-level kind', () => {
    const seen: Array<GateSpec | null> = [];
    const brain = new Brain({
      store: new InMemoryBrainStore(),
      resolveGateFloor: (_projectId, _kind, requested) => {
        seen.push(requested);
        return requested?.kind === 'ui' ? ['screenshot'] : [];
      },
    });
    const job = brain.createJob(BRAIN, {
      projectId: 'p1',
      title: 't',
      gateSpec: { gates: [], kind: 'ui' },
    });
    expect(seen).toEqual([{ gates: [], kind: 'ui' }]);
    expect(job.gateSpec).toEqual({ gates: ['screenshot'], kind: 'ui' });
  });
});

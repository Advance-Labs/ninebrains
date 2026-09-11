import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN, LANE, createGateFixture, scriptedGate, type GateFixture } from './test-fixtures';

let fixture: GateFixture | undefined;
afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

/** A gate that waits until it is aborted, like a crash or shutdown mid-gate. */
function hangingGate() {
  return scriptedGate(
    'tests',
    [false],
    (ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
  );
}

describe('gate runner is idempotent per (jobId, attempt)', () => {
  it('concurrent triggers for one attempt share a single run', async () => {
    const tests = scriptedGate('tests', [false]);
    fixture = await createGateFixture({ gates: [tests] });
    const job = fixture.createJob();

    const [a, b] = [fixture.runner.verifyJob(job.id), fixture.runner.verifyJob(job.id)];
    expect(a).toBe(b);
    await a;

    expect(tests.calls).toBe(1);
    expect(fixture.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
    expect(fixture.brain.readInbox(LANE)).toHaveLength(1);
  });

  it('a crash mid-gate never double-counts: the attempt is re-run once, counted once', async () => {
    fixture = await createGateFixture({ gates: [hangingGate()] });
    const job = fixture.createJob();

    const interrupted = fixture.runner.verifyJob(job.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.runner.stop();
    expect(await interrupted).toMatchObject({ applied: false, attempt: 1 });

    // Nothing was recorded and no verdict was kept: the attempt is still open.
    expect(fixture.job(job.id)).toMatchObject({ state: 'verifying', attempts: 0 });
    expect(existsSync(join(fixture.evidenceRoot, job.id, '1', 'verdict.json'))).toBe(false);

    const failing = scriptedGate('tests', [false]);
    const restarted = fixture.makeRunner({ builtInGates: () => [failing] });
    restarted.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    restarted.stop();

    expect(failing.calls).toBe(1);
    expect(fixture.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
    expect(fixture.brain.readInbox(LANE)).toHaveLength(1);
  });

  it('a verdict written before a crash is replayed, not re-run', async () => {
    const tests = scriptedGate('tests', [false]);
    fixture = await createGateFixture({ gates: [tests] });
    const f = fixture;
    const job = f.createJob();

    // The process dies between writing verdict.json and recording it in the Brain.
    const crashing = f.makeRunner({
      brain: {
        events: f.brain.events,
        getJob: (identity, id) => f.brain.getJob(identity, id),
        listJobs: (identity, filter) => f.brain.listJobs(identity, filter),
        recordGateResult: () => {
          throw new Error('simulated crash');
        },
      },
    });
    await expect(crashing.verifyJob(job.id)).rejects.toThrow('simulated crash');
    expect(existsSync(join(f.evidenceRoot, job.id, '1', 'verdict.json'))).toBe(true);
    expect(f.job(job.id)).toMatchObject({ state: 'verifying', attempts: 0 });

    const outcome = await f.makeRunner().verifyJob(job.id);

    expect(outcome).toMatchObject({ replayed: true, applied: true, attempt: 1 });
    expect(tests.calls).toBe(1);
    expect(f.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
  });

  it('two runners racing on one attempt record it exactly once', async () => {
    fixture = await createGateFixture({ gates: [scriptedGate('tests', [false])] });
    const job = fixture.createJob();

    const outcomes = await Promise.all([
      fixture.makeRunner().verifyJob(job.id),
      fixture.makeRunner().verifyJob(job.id),
    ]);

    expect(outcomes.filter((o) => o?.applied)).toHaveLength(1);
    expect(fixture.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
    expect(fixture.brain.readInbox(LANE)).toHaveLength(1);
  });

  it('a requeued job re-runs attempt 1 instead of replaying the old verdict', async () => {
    const tests = scriptedGate('tests', [false, false, false, true]);
    fixture = await createGateFixture({ gates: [tests] });
    const job = fixture.createJob();
    for (const attempt of [1, 2, 3]) {
      if (attempt > 1) fixture.resubmit(job.id);
      await fixture.runner.verifyJob(job.id);
    }
    expect(fixture.job(job.id).state).toBe('blocked');

    fixture.brain.requeueJob(BRAIN, job.id);
    fixture.brain.claimJob(LANE, job.id, { start: true });
    fixture.brain.completeJob(LANE, job.id, { summary: 'fresh start' });
    const outcome = await fixture.runner.verifyJob(job.id);

    expect(outcome).toMatchObject({ attempt: 1, replayed: false, status: 'passed' });
    expect(tests.calls).toBe(4);
    expect(fixture.job(job.id).state).toBe('done');
  });
});

import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COMPLETE_JOB_TOOL } from '@emdash/gates-core';
import { afterEach, describe, expect, it } from 'vitest';
import { readJobHistory } from '../evidence/evidence';
import { JOB_BLOCKED_NOTIFICATION_KIND } from '../notifications/job-blocked';
import {
  LANE,
  createGateFixture,
  scriptedGate,
  waitFor,
  type GateFixture,
  type GateFixtureOptions,
} from './test-fixtures';

let fixture: GateFixture | undefined;
async function setup(options: GateFixtureOptions = {}) {
  fixture = await createGateFixture(options);
  return fixture;
}
afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe('gate runner verdicts', () => {
  it('pass → done, verified, with the evidence manifest path', async () => {
    const f = await setup({ gates: [scriptedGate('tests', [true])] });
    const job = f.createJob();
    expect(job.gateSpec?.gates).toEqual(['tests']); // the default floor for code at 5/5

    const outcome = await f.runner.verifyJob(job.id);

    expect(outcome).toMatchObject({ status: 'passed', decision: 'pass', applied: true });
    const done = f.job(job.id);
    expect(done.state).toBe('done');
    const verification = done.result?.verification;
    expect(verification).toMatchObject({ status: 'passed', verified: true, attempt: 1 });
    expect(verification?.evidencePath).toBe(
      join(realpathSync(f.evidenceRoot), job.id, '1', 'manifest.json')
    );
    expect(existsSync(verification!.evidencePath!)).toBe(true);
  });

  it('fail → running, attempt counted, feedback in the lane inbox naming complete_job', async () => {
    const tests = scriptedGate('tests', [false, true]);
    const f = await setup({ gates: [tests] });
    const job = f.createJob();

    const first = await f.runner.verifyJob(job.id);
    expect(first).toMatchObject({ status: 'failed', decision: 'retry', attempt: 1 });
    expect(f.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
    const [message] = f.brain.readInbox(LANE);
    expect(message?.body).toContain('tests found a problem');
    expect(message?.body).toContain(COMPLETE_JOB_TOOL);
    expect(message?.body).toContain('Attempt 1 of 3');

    f.resubmit(job.id);
    const second = await f.runner.verifyJob(job.id);
    expect(second).toMatchObject({ status: 'passed', attempt: 2 });
    expect(f.job(job.id).result?.verification).toMatchObject({ verified: true, attempt: 2 });

    const history = await readJobHistory(f.evidenceRoot, job.id);
    expect(history.map((h) => [h.attempt, h.verdict?.decision])).toEqual([
      [1, 'retry'],
      [2, 'pass'],
    ]);
  });

  it('three failures → blocked, plus a notification', async () => {
    const f = await setup({ gates: [scriptedGate('tests', [false])] });
    const job = f.createJob(null, 'Fix the header');
    for (const attempt of [1, 2, 3]) {
      if (attempt > 1) f.resubmit(job.id);
      await f.runner.verifyJob(job.id);
    }
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 3 });
    expect(f.job(job.id).reason).toContain('tests found a problem');

    await waitFor(() => f.notifications.length === 1);
    expect(f.notifications[0]).toMatchObject({
      kind: JOB_BLOCKED_NOTIFICATION_KIND,
      title: 'Job blocked: Fix the header',
      sound: 'needs_attention',
      source: { kind: 'app' },
    });
    expect(f.brain.readInbox(LANE)).toHaveLength(3);
  });

  it('no gates → done but unverified, never passed', async () => {
    const f = await setup({ settings: { testingRigor: 0, securityRigor: 0 } });
    const job = f.createJob();
    expect(job.gateSpec).toBeNull();

    const outcome = await f.runner.verifyJob(job.id);

    expect(outcome).toMatchObject({ status: 'unverified', decision: 'pass' });
    expect(f.job(job.id).state).toBe('done');
    expect(f.job(job.id).result?.verification).toMatchObject({
      status: 'unverified',
      verified: false,
      evidencePath: null,
    });
  });

  it('a gate nobody provides fails the job instead of passing it', async () => {
    const f = await setup({ gates: [scriptedGate('tests', [true])] });
    const job = f.createJob({ gates: ['does-not-exist'] });
    await f.runner.verifyJob(job.id);
    // The worker can't install a gate, so the job blocks without using an attempt.
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 0 });
    expect(f.job(job.id).reason).toContain('"does-not-exist" is not installed');
  });

  it('a lane that is gone blocks the job as a setup problem', async () => {
    const f = await setup({ gates: [scriptedGate('tests', [true])], laneAvailable: false });
    const job = f.createJob();
    await f.runner.verifyJob(job.id);
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 0 });
    expect(f.job(job.id).reason).toContain('is not available');
    expect(f.brain.readInbox(LANE)).toHaveLength(0);
  });

  it('start() picks up jobs already verifying, then follows Brain events', async () => {
    const tests = scriptedGate('tests', [true]);
    const f = await setup({ gates: [tests] });
    const early = f.createJob(null, 'left over from a crash');
    f.runner.start();
    await waitFor(() => f.job(early.id).state === 'done');

    const late = f.createJob(null, 'arrives while running');
    await waitFor(() => f.job(late.id).state === 'done');
    expect(tests.calls).toBe(2);
  });

  it('passes pack gates alongside the built-ins', async () => {
    const seo = scriptedGate('seo-evidence', [true]);
    const f = await setup({ gates: [scriptedGate('tests', [true])], extraGates: [seo] });
    const job = f.createJob({ gates: ['seo-evidence'] });
    await f.runner.verifyJob(job.id);
    expect(seo.calls).toBe(1);
    expect(f.job(job.id).state).toBe('done');
  });
});

describe('SEC-22 worker artifacts are not evidence', () => {
  it('gates never see the worker artifacts; the manifest holds only gate output', async () => {
    const tests = scriptedGate('tests', [true]);
    const f = await setup({ gates: [tests] });
    const job = f.createJob();
    expect(job.result?.artifacts).toEqual(['proof.png']);

    await f.runner.verifyJob(job.id);

    expect(tests.seen[0]?.job.artifacts).toBeUndefined();
    const manifest = JSON.parse(
      await readFile(join(f.evidenceRoot, job.id, '1', 'manifest.json'), 'utf8')
    ) as { evidence: Array<{ file: string }> };
    expect(manifest.evidence.map((e) => e.file)).toEqual(['tests.log']);
  });
});

describe('SEC-24 evidence stays out of the worktree', () => {
  it('refuses to verify when the evidence root is inside the lane worktree', async () => {
    const f = await setup({ gates: [scriptedGate('tests', [true])] });
    const runner = f.makeRunner({ evidenceRoot: join(f.worktree, '.ninebrains', 'evidence') });
    const job = f.createJob();
    await runner.verifyJob(job.id);
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 0 });
    expect(f.job(job.id).reason).toContain('inside the lane worktree');
  });
});

describe('SEC-20 a tests-gate sandbox refusal is a non-retryable failure', () => {
  it('blocks at once, uses no attempt, and notifies the user', async () => {
    const f = await setup({
      prefs: { testCommand: 'pnpm test' },
      capabilities: {
        runCommand: async () => {
          throw new Error('refused: no OS sandbox (bwrap) on this machine; set allowUnsandboxed');
        },
      },
    });
    const job = f.createJob();

    const outcome = await f.runner.verifyJob(job.id);

    expect(outcome).toMatchObject({ decision: 'block', applied: true, attempt: 1 });
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 0 });
    expect(f.job(job.id).reason).toContain('bwrap');
    expect(f.job(job.id).reason).toContain('no attempt was used');
    expect(f.brain.readInbox(LANE)).toHaveLength(0);
    await waitFor(() => f.notifications.length === 1);
  });

  it('a failing test run (the command ran) still retries', async () => {
    const f = await setup({
      prefs: { testCommand: 'pnpm test' },
      capabilities: { runCommand: async () => ({ exitCode: 1, stdout: '1 failed', stderr: '' }) },
    });
    const job = f.createJob();
    await f.runner.verifyJob(job.id);
    expect(f.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
  });

  it('no test command configured blocks too', async () => {
    const f = await setup();
    const job = f.createJob();
    await f.runner.verifyJob(job.id);
    expect(f.job(job.id)).toMatchObject({ state: 'blocked', attempts: 0 });
    expect(f.job(job.id).reason).toContain('No test command is set');
  });
});

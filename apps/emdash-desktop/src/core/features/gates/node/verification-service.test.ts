import { RIGOR_THRESHOLDS, rigorToGates } from '@emdash/gates-core';
import { afterEach, describe, expect, it } from 'vitest';
import { RIGOR_TABLE, gatesAttachedAt } from '../api/rigor-table';
import { createGateFixture, scriptedGate, type GateFixture } from './runner/test-fixtures';
import { createVerificationService, unavailableVerificationService } from './verification-service';

let fixture: GateFixture | undefined;
afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe('verification service', () => {
  it('shows each attempt with its verdict, and the worker artifacts separately', async () => {
    fixture = await createGateFixture({ gates: [scriptedGate('tests', [false, true])] });
    const f = fixture;
    const job = f.createJob();
    await f.runner.verifyJob(job.id);
    f.resubmit(job.id);
    await f.runner.verifyJob(job.id);

    const service = createVerificationService({ brain: f.brain, evidenceRoot: f.evidenceRoot });
    const view = await service.getVerification(job.id);

    expect(view.success).toBe(true);
    if (!view.success) return;
    expect(view.data).toMatchObject({
      jobId: job.id,
      state: 'done',
      kind: 'code',
      attempts: 1,
      maxAttempts: 3,
      latest: { status: 'passed', verified: true, attempt: 2 },
      // The Brain keeps the latest complete_job report; the resubmit named no files.
      workerArtifacts: [],
    });
    expect(view.data.history.map((h) => h.verdict?.decision)).toEqual(['retry', 'pass']);
    expect(view.data.history[0]?.evidence.map((e) => e.file)).toEqual(['tests.log']);
  });

  it('serves an evidence file as base64 and deletes evidence on request', async () => {
    fixture = await createGateFixture({ gates: [scriptedGate('tests', [true])] });
    const f = fixture;
    const job = f.createJob();
    await f.runner.verifyJob(job.id);
    const service = createVerificationService({ brain: f.brain, evidenceRoot: f.evidenceRoot });

    const log = await service.readEvidence({ jobId: job.id, attempt: 1, file: 'tests.log' });
    expect(log.success && Buffer.from(log.data.base64, 'base64').toString()).toBe('tests ok');
    const refused = await service.readEvidence({ jobId: job.id, attempt: 1, file: '../x.png' });
    expect(refused).toMatchObject({ success: false, error: { type: 'refused' } });

    expect((await service.deleteEvidence(job.id)).success).toBe(true);
    const after = await service.getVerification(job.id);
    expect(after.success && after.data.history).toEqual([]);
  });

  it('reports unknown jobs and an unwired Brain as errors, not throws', async () => {
    fixture = await createGateFixture();
    const service = createVerificationService({
      brain: fixture.brain,
      evidenceRoot: fixture.evidenceRoot,
    });
    expect(await service.getVerification('nope')).toMatchObject({
      success: false,
      error: { type: 'not-found' },
    });
    expect(await unavailableVerificationService.getVerification('x')).toMatchObject({
      success: false,
      error: { type: 'unavailable' },
    });
  });
});

describe('rigor table (renderer copy)', () => {
  it('matches gates-core thresholds and rigorToGates at every level', () => {
    const byGate = Object.fromEntries(RIGOR_TABLE.map((row) => [row.gate, row.threshold]));
    expect(byGate).toEqual({
      tests: RIGOR_THRESHOLDS.tests,
      'fact-check': RIGOR_THRESHOLDS.factCheck,
      screenshot: RIGOR_THRESHOLDS.screenshot,
      'security-review': RIGOR_THRESHOLDS.securityReview,
      reviewer: RIGOR_THRESHOLDS.reviewer,
    });
    for (let testing = 0; testing <= 10; testing += 1) {
      for (let security = 0; security <= 10; security += 1) {
        const expected = new Set(
          (['code', 'ui', 'research', 'seo', 'docs'] as const).flatMap((kind) =>
            rigorToGates({ testing, security }, kind)
          )
        );
        expect(gatesAttachedAt(testing, security)).toEqual(expected);
      }
    }
  });
});

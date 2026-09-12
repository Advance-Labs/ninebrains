/** Reads a job's verification (Brain state + evidence on disk) for the "Job verification" modal. */
import { err, ok, type Result } from '@emdash/shared';
import { MAX_ATTEMPTS, type Brain, type Identity, type Job } from '@ninebrains/brain-core';
import type { GatesError } from '../api/contract';
import type { JobVerificationView } from '../api/verification';
import { deleteJobEvidence, readEvidenceFile, readJobHistory } from './evidence/evidence';
import { gateJobKindOf } from './rigor/rigor';
import { GATE_RUNNER_IDENTITY } from './runner/gate-runner';

export interface GatesVerificationService {
  getVerification(jobId: string): Promise<Result<JobVerificationView, GatesError>>;
  readEvidence(input: {
    jobId: string;
    attempt: number;
    file: string;
  }): Promise<Result<{ mime: string; base64: string }, GatesError>>;
  deleteEvidence(jobId: string): Promise<Result<{ jobId: string }, GatesError>>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createVerificationService(deps: {
  brain: Pick<Brain, 'getJob'>;
  evidenceRoot: string;
  identity?: Identity;
}): GatesVerificationService {
  const identity = deps.identity ?? GATE_RUNNER_IDENTITY;
  const load = (jobId: string): Result<Job, GatesError> => {
    try {
      return ok(deps.brain.getJob(identity, jobId));
    } catch {
      return err({ type: 'not-found', message: `There is no job ${jobId}.` });
    }
  };

  return {
    async getVerification(jobId) {
      const loaded = load(jobId);
      if (!loaded.success) return loaded;
      const job = loaded.data;
      const verification = job.result?.verification;
      return ok({
        jobId: job.id,
        title: job.title,
        state: job.state,
        kind: gateJobKindOf(job.gateSpec),
        attempts: job.attempts,
        maxAttempts: MAX_ATTEMPTS,
        latest: verification
          ? {
              status: verification.status,
              verified: verification.verified,
              attempt: verification.attempt,
            }
          : null,
        workerArtifacts: job.result?.artifacts ?? [],
        history: await readJobHistory(deps.evidenceRoot, job.id),
      });
    },
    async readEvidence({ jobId, attempt, file }) {
      try {
        const { mime, data } = await readEvidenceFile(deps.evidenceRoot, jobId, attempt, file);
        return ok({ mime, base64: data.toString('base64') });
      } catch (error) {
        return err({ type: 'refused', message: message(error) });
      }
    },
    async deleteEvidence(jobId) {
      try {
        await deleteJobEvidence(deps.evidenceRoot, jobId);
        return ok({ jobId });
      } catch (error) {
        return err({ type: 'refused', message: message(error) });
      }
    },
  };
}

const UNAVAILABLE: GatesError = {
  type: 'unavailable',
  message: 'The Brain is not running yet, so there is no verification to show.',
};

/** Used by the controller manifest until boot wiring passes the real service. */
export const unavailableVerificationService: GatesVerificationService = {
  getVerification: async () => err(UNAVAILABLE),
  readEvidence: async () => err(UNAVAILABLE),
  deleteEvidence: async () => err(UNAVAILABLE),
};

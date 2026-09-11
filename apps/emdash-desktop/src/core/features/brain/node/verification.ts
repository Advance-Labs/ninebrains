import type { Brain, Identity, Job, Note } from '@ninebrains/brain-core';

/**
 * Hand-off from `verifying` to the gate runner. The gates slice (w5-gates-wiring)
 * owns the runner; until it is wired, a job that reaches `verifying` is marked
 * `done` with an explicit **unverified** record, never a silent pass.
 */
export interface GateRunnerPort {
  verify(job: Job): Promise<{ pass: boolean; feedback?: string }>;
}

export const GATES_IDENTITY: Identity = { role: 'brain', brainId: 'gates' };
export const VERIFIED_PREFIX = '[gates] verified:';
export const UNVERIFIED_PREFIX = '[gates] unverified:';

/** Whether the latest gate note for `jobId` says the job was verified. */
export function isVerified(notes: readonly Note[], jobId: string): boolean {
  let latest: Note | undefined;
  for (const note of notes) {
    if (note.jobId !== jobId || note.author.kind !== 'brain' || note.author.id !== 'gates') {
      continue;
    }
    if (!latest || note.createdAt >= latest.createdAt) latest = note;
  }
  return latest?.body.startsWith(VERIFIED_PREFIX) ?? false;
}

export interface VerificationOptions {
  brain: Brain;
  gateRunner?: GateRunnerPort;
  onError(context: string, error: unknown): void;
}

export interface VerificationHandler {
  /** Resolves once every queued verification has settled. For tests. */
  settled(): Promise<void>;
  dispose(): void;
}

export function startVerification(options: VerificationOptions): VerificationHandler {
  const { brain } = options;
  const pending = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const verify = async (jobId: string) => {
    const job = brain.getJob(GATES_IDENTITY, jobId);
    if (job.state !== 'verifying') return;
    const gates = job.gateSpec?.gates ?? [];
    if (!options.gateRunner) {
      const listed = gates.length > 0 ? gates.join(', ') : 'none requested';
      brain.addNote(GATES_IDENTITY, {
        jobId,
        body: `${UNVERIFIED_PREFIX} no gate runner is connected, so no gate ran (gates: ${listed}).`,
      });
      brain.recordGateResult(GATES_IDENTITY, jobId, { pass: true });
      return;
    }
    let verdict: { pass: boolean; feedback?: string };
    try {
      verdict = await options.gateRunner.verify(job);
    } catch (error) {
      options.onError('brain: gate runner failed', error);
      verdict = { pass: false, feedback: 'The gate runner failed, so the work was not verified.' };
    }
    if (verdict.pass) {
      brain.addNote(GATES_IDENTITY, {
        jobId,
        body: `${VERIFIED_PREFIX} ${gates.length > 0 ? gates.join(', ') : 'no gates'} passed.`,
      });
    }
    brain.recordGateResult(GATES_IDENTITY, jobId, verdict);
  };

  const off = brain.events.on('jobChanged', ({ job }) => {
    if (job.state !== 'verifying' || pending.has(job.id)) return;
    pending.add(job.id);
    // Listeners run after commit; the follow-up write runs on its own turn.
    chain = chain
      .then(() => verify(job.id))
      .catch((error: unknown) => options.onError('brain: verification failed', error))
      .finally(() => pending.delete(job.id));
  });

  return {
    settled: async () => {
      while (pending.size > 0) await chain;
    },
    dispose: off,
  };
}

import { z } from 'zod';

export const runStatusSchema = z.enum(['passed', 'failed', 'unverified']);
export type RunStatusValue = z.infer<typeof runStatusSchema>;

export const gateStatusSchema = z.enum(['pass', 'fail', 'timeout', 'error', 'cancelled']);
export const evidenceKindSchema = z.enum(['screenshot', 'log', 'diff', 'json', 'text']);

/** One line of gates-core's per-attempt `manifest.json`. */
export const evidenceManifestEntrySchema = z.object({
  kind: evidenceKindSchema,
  label: z.string(),
  file: z.string(),
  bytes: z.number(),
  createdAt: z.string(),
});
export type EvidenceManifestEntry = z.infer<typeof evidenceManifestEntrySchema>;

export const evidenceManifestSchema = z.object({
  jobId: z.string(),
  attempt: z.number(),
  evidence: z.array(evidenceManifestEntrySchema),
});

export const gateVerdictSchema = z.object({
  gateId: z.string(),
  title: z.string(),
  status: gateStatusSchema,
  feedback: z.string(),
  durationMs: z.number(),
  evidence: z.array(z.object({ kind: evidenceKindSchema, label: z.string(), file: z.string() })),
});
export type GateVerdict = z.infer<typeof gateVerdictSchema>;

/** `verdict.json`: what the runner decided for one attempt, written before the Brain records it. */
export const attemptVerdictSchema = z.object({
  version: z.literal(1),
  jobId: z.string(),
  attempt: z.number().int().min(1),
  /** The job's `updatedAt` when it was verified; a replay must match it (requeue starts over). */
  jobUpdatedAt: z.number(),
  status: runStatusSchema,
  decision: z.enum(['pass', 'retry', 'block']),
  /** What went to the lane's inbox (retry), the block reason, or the pass summary. */
  feedback: z.string(),
  gateIds: z.array(z.string()),
  gates: z.array(gateVerdictSchema),
  skipped: z.array(z.string()),
  at: z.number(),
});
export type AttemptVerdict = z.infer<typeof attemptVerdictSchema>;

export const attemptHistorySchema = z.object({
  attempt: z.number(),
  evidence: z.array(evidenceManifestEntrySchema),
  /** Null while the attempt is still being verified, or if it crashed before a verdict. */
  verdict: attemptVerdictSchema.nullable(),
});
export type AttemptHistory = z.infer<typeof attemptHistorySchema>;

/** Everything the "Job verification" modal shows. */
export const jobVerificationViewSchema = z.object({
  jobId: z.string(),
  title: z.string(),
  state: z.string(),
  kind: z.string(),
  attempts: z.number(),
  maxAttempts: z.number(),
  latest: z
    .object({ status: runStatusSchema, verified: z.boolean(), attempt: z.number() })
    .nullable(),
  /** SEC-22: shown labelled "worker-supplied", never treated as evidence. */
  workerArtifacts: z.array(z.string()),
  history: z.array(attemptHistorySchema),
});
export type JobVerificationView = z.infer<typeof jobVerificationViewSchema>;

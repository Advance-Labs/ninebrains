import { z } from 'zod';

/** Brain job states (brain-core `JOB_STATES`), mirrored here so the renderer needs no brain-core. */
export const brainJobStateSchema = z.enum([
  'proposed',
  'ready',
  'claimed',
  'running',
  'verifying',
  'done',
  'blocked',
  'failed',
]);
export type BrainJobState = z.infer<typeof brainJobStateSchema>;

/** SEC-14: every id that can reach a path is a safe path segment. */
export const brainIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const brainAddressSchema = z.object({
  kind: z.enum(['lane', 'brain']),
  id: brainIdSchema,
});
export type BrainAddress = z.infer<typeof brainAddressSchema>;

export const brainJobViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  state: brainJobStateSchema,
  laneId: z.string().nullable(),
  attempts: z.number().int(),
  reason: z.string().nullable(),
  gates: z.array(z.string()),
  /** The Brain session that created the job, if one did. Lane replies go there. */
  createdByBrain: z.string().nullable(),
  updatedAt: z.number(),
});
export type BrainJobView = z.infer<typeof brainJobViewSchema>;

export const brainDoneViewSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  title: z.string(),
  projectId: z.string(),
  laneId: z.string().nullable(),
  summary: z.string(),
  artifacts: z.array(z.string()),
  at: z.number(),
  /** False unless a gate runner passed the job. Unverified work is never shown as verified. */
  verified: z.boolean(),
});
export type BrainDoneView = z.infer<typeof brainDoneViewSchema>;

export const brainNoteViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  jobId: z.string().nullable(),
  author: brainAddressSchema,
  body: z.string(),
  at: z.number(),
});
export type BrainNoteView = z.infer<typeof brainNoteViewSchema>;

export const brainMessageViewSchema = z.object({
  id: z.string(),
  from: brainAddressSchema,
  to: brainAddressSchema,
  body: z.string(),
  at: z.number(),
  readAt: z.number().nullable(),
  /** SEC-09: anything a lane wrote is data, never instructions. */
  untrusted: z.boolean(),
});
export type BrainMessageView = z.infer<typeof brainMessageViewSchema>;

export const brainSessionStatusSchema = z.enum(['starting', 'running', 'stopped', 'failed']);

export const brainSessionViewSchema = z.object({
  brainId: brainIdSchema,
  projectId: z.string(),
  taskId: z.string(),
  conversationId: z.string(),
  title: z.string(),
  status: brainSessionStatusSchema,
  error: z.string().nullable(),
});
export type BrainSessionView = z.infer<typeof brainSessionViewSchema>;

export const laneRunModeSchema = z.enum(['attended', 'unattended']);
export type LaneRunMode = z.infer<typeof laneRunModeSchema>;

export const brainDispatcherViewSchema = z.object({
  paused: z.boolean(),
  /** Global STOP latched: no dispatch and no runs until cleared. */
  stopLatched: z.boolean(),
  laneModes: z.record(z.string(), laneRunModeSchema),
  activeRuns: z.number().int(),
  gatesConnected: z.boolean(),
});
export type BrainDispatcherView = z.infer<typeof brainDispatcherViewSchema>;

/** Unread counts keyed by `lane:<id>` or `brain:<id>` (display keys, never paths). */
export const brainUnreadSchema = z.record(z.string(), z.number().int());
export type BrainUnread = z.infer<typeof brainUnreadSchema>;

export function addressKey(address: BrainAddress): string {
  return `${address.kind}:${address.id}`;
}

export const brainErrorSchema = z.object({
  type: z.enum(['not-found', 'forbidden', 'invalid', 'conflict', 'unavailable', 'internal']),
  message: z.string(),
});
export type BrainError = z.infer<typeof brainErrorSchema>;

export type BrainWireEvent =
  | { type: 'job-changed'; jobId: string; projectId: string; state: BrainJobState }
  | { type: 'job-blocked'; jobId: string; projectId: string; reason: string }
  | { type: 'message'; messageId: string; to: BrainAddress }
  | { type: 'stop'; latched: boolean };

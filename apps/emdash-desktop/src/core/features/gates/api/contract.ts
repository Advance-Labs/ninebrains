import { defineContract, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';
import { jobVerificationViewSchema } from './verification';

export const gatesDomain = 'gates' as const;

export const gatesErrorSchema = z.object({
  type: z.enum(['unavailable', 'not-found', 'refused']),
  message: z.string(),
});
export type GatesError = z.infer<typeof gatesErrorSchema>;

const jobId = z.string().min(1).max(64);

export const gatesContract = defineContract({
  /** Everything the "Job verification" modal shows for one job. */
  getVerification: fallible({
    input: z.object({ jobId }),
    data: jobVerificationViewSchema,
    error: gatesErrorSchema,
  }),
  /** One stored evidence file (screenshot, log, JSON) as base64. */
  readEvidence: fallible({
    input: z.object({
      jobId,
      attempt: z.number().int().min(1).max(9999),
      file: z.string().min(1).max(120),
    }),
    data: z.object({ mime: z.string(), base64: z.string() }),
    error: gatesErrorSchema,
  }),
  /** SEC-24: the per-job "delete evidence" action. */
  deleteEvidence: fallible({
    input: z.object({ jobId }),
    data: z.object({ jobId: z.string() }),
    error: gatesErrorSchema,
  }),
});

export type GatesContract = typeof gatesContract;

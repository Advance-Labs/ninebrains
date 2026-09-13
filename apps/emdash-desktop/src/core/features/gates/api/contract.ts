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
const projectId = z.string().min(1).max(200);

const rigorLevel = z.number().int().min(0).max(10);

/**
 * Settings → Gates, per project. `testCommand` null means none is set: code and UI jobs block.
 * `rigorLevel` null means "use the app's rigor sliders"; a level overrides both testing and
 * security rigor for this project (SEC-08). `allowNetwork` and `allowUnsandboxed` both default to
 * false and are the tests-gate sandbox opt-outs (SEC-20, THREAT-MODEL R11/R12) — set here only.
 */
export const gatesProjectPrefsViewSchema = z.object({
  projectId: z.string(),
  testCommand: z.string().nullable(),
  rigorLevel: rigorLevel.nullable(),
  allowNetwork: z.boolean(),
  allowUnsandboxed: z.boolean(),
});
export type GatesProjectPrefsView = z.infer<typeof gatesProjectPrefsViewSchema>;

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
  getProjectPrefs: fallible({
    input: z.object({ projectId }),
    data: gatesProjectPrefsViewSchema,
    error: gatesErrorSchema,
  }),
  /** SEC-20: the tests gate's command. Only this user action sets it, never a job or a worktree. */
  setTestCommand: fallible({
    input: z.object({ projectId, testCommand: z.string().max(500).nullable() }),
    data: gatesProjectPrefsViewSchema,
    error: gatesErrorSchema,
  }),
  /**
   * SEC-08: the project rigor override and the tests-gate sandbox opt-outs. Only this user
   * action (Settings → Gates) sets them; no agent or job path can reach this contract.
   */
  setProjectSettings: fallible({
    input: z.object({
      projectId,
      rigorLevel: rigorLevel.nullable(),
      allowNetwork: z.boolean(),
      allowUnsandboxed: z.boolean(),
    }),
    data: gatesProjectPrefsViewSchema,
    error: gatesErrorSchema,
  }),
});

export type GatesContract = typeof gatesContract;

import { LIMITS, JOB_STATES, utf8Bytes } from '@ninebrains/brain-core';
import { z } from 'zod';

/**
 * Boundary validation for every tool. The core re-checks the same limits,
 * but rejecting here gives the agent a precise, early error.
 */

const bytes = (max: number, label: string) =>
  z.string().refine((value) => utf8Bytes(value) <= max, { message: `${label} must be at most ${max} bytes` });

export const id = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, 'ids are 1-128 characters of letters, digits, . _ : -');

export const address = z
  .string()
  .regex(/^(lane|brain):[A-Za-z0-9._:-]{1,128}$/, 'address must be lane:<id> or brain:<id>');

export const body = bytes(LIMITS.bodyBytes, 'body').refine((v) => v.trim().length > 0, {
  message: 'body must not be empty',
});

export const attachment = z.union([
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(LIMITS.pathChars) }),
  z.object({ kind: z.literal('screenshot'), ref: z.string().min(1).max(LIMITS.pathChars) }),
]);

export const attachments = z.array(attachment).max(LIMITS.attachments);

export const jobState = z.enum(JOB_STATES);

export const shapes = {
  claimJob: {
    jobId: id.optional().describe('Job to claim. Omit to take the oldest ready job in your project.'),
  },
  completeJob: {
    jobId: id,
    summary: bytes(LIMITS.summaryBytes, 'summary')
      .refine((v) => v.trim().length > 0, { message: 'summary must not be empty' })
      .describe('What you did and how you verified it. The reviewer and the done log read this.'),
    artifacts: z
      .array(z.string().min(1).max(LIMITS.pathChars))
      .max(LIMITS.artifacts)
      .default([])
      .describe('Paths (inside the project or evidence dir) that prove the work: screenshots, logs, reports.'),
  },
  block: {
    jobId: id,
    reason: z.string().min(1).max(LIMITS.reasonChars).describe('What is blocking you and what would unblock it.'),
  },
  sendMessage: {
    to: address.describe('lane:<id> for another lane, brain:<id> for a Brain session.'),
    body,
    attachments: attachments.default([]),
  },
  readInbox: {
    limit: z.number().int().min(1).max(200).default(50),
  },
  readInboxBrain: {
    limit: z.number().int().min(1).max(200).default(50),
    address: address.optional().describe('Inbox to read. Defaults to your own brain inbox.'),
  },
  listJobs: {
    states: z.array(jobState).max(JOB_STATES.length).optional().describe('Only jobs in these states.'),
    mine: z.boolean().default(false).describe('Only jobs held by this lane.'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  listJobsBrain: {
    states: z.array(jobState).max(JOB_STATES.length).optional(),
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    laneId: id.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  },
  addNote: {
    body,
    jobId: id.optional().describe('Attach the note to a job. Omit for a project-wide note.'),
  },
  createJob: {
    title: z.string().trim().min(1).max(LIMITS.titleChars),
    body: bytes(LIMITS.bodyBytes, 'body').default(''),
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    dependsOn: z.array(id).max(100).default([]).describe('Job ids that must be done before this one is ready.'),
    gates: z
      .array(z.string().min(1).max(64))
      .max(10)
      .optional()
      .describe('Verification gates to run on completion, e.g. ["tests", "screenshot", "reviewer"].'),
    kind: z.enum(['work', 'review']).optional(),
    paths: z.array(z.string().min(1).max(LIMITS.pathChars)).max(100).optional().describe('Files the job will touch; used for routing.'),
  },
  linkJobs: {
    from: id.describe('The prerequisite job.'),
    to: id.describe('The job that must wait for `from` to be done.'),
  },
  assignJob: { jobId: id, laneId: id },
  requeueJob: { jobId: id },
  listLanes: { projectId: id.optional() },
  broadcast: {
    body,
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    attachments: attachments.default([]),
  },
} as const;

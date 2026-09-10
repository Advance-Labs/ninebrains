import { LIMITS, TASK_STATES, utf8Bytes } from '@ninebrains/brain-core';
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

export const taskState = z.enum(TASK_STATES);

export const shapes = {
  claimTask: {
    taskId: id.optional().describe('Task to claim. Omit to take the oldest ready task in your project.'),
  },
  completeTask: {
    taskId: id,
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
    taskId: id,
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
  listTasks: {
    states: z.array(taskState).max(TASK_STATES.length).optional().describe('Only tasks in these states.'),
    mine: z.boolean().default(false).describe('Only tasks held by this lane.'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  listTasksBrain: {
    states: z.array(taskState).max(TASK_STATES.length).optional(),
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    laneId: id.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  },
  addNote: {
    body,
    taskId: id.optional().describe('Attach the note to a task. Omit for a project-wide note.'),
  },
  createTask: {
    title: z.string().trim().min(1).max(LIMITS.titleChars),
    body: bytes(LIMITS.bodyBytes, 'body').default(''),
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    dependsOn: z.array(id).max(100).default([]).describe('Task ids that must be done before this one is ready.'),
    gates: z
      .array(z.string().min(1).max(64))
      .max(10)
      .optional()
      .describe('Verification gates to run on completion, e.g. ["tests", "screenshot", "reviewer"].'),
    kind: z.enum(['work', 'review']).optional(),
    paths: z.array(z.string().min(1).max(LIMITS.pathChars)).max(100).optional().describe('Files the task will touch; used for routing.'),
  },
  linkTasks: {
    from: id.describe('The prerequisite task.'),
    to: id.describe('The task that must wait for `from` to be done.'),
  },
  assignTask: { taskId: id, laneId: id },
  requeueTask: { taskId: id },
  listLanes: { projectId: id.optional() },
  broadcast: {
    body,
    projectId: id.optional().describe('Defaults to this session\'s project.'),
    attachments: attachments.default([]),
  },
} as const;

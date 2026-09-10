/**
 * The Brain forwarding contract, version 1.
 *
 * A lane's brain-mcp shim turns each tool call into one `BrainRequest` and
 * POSTs it to the app's main process, which owns the DB and answers with a
 * `BrainResponse`. Identity is never part of the request: main derives it
 * from the per-lane token (see http.ts), so a lane cannot claim to be
 * another lane. The same request objects run in-process in direct-DB mode.
 */
import { z } from 'zod';
import { LIMITS, utf8Bytes } from '../limits';
import { JOB_STATES } from '../types';

export const BRAIN_PROTOCOL_VERSION = 1 as const;

const bytes = (max: number, label: string) =>
  z.string().refine((value) => utf8Bytes(value) <= max, { message: `${label} must be at most ${max} bytes` });

const notBlank = (label: string) => (value: string) => value.trim().length > 0 || `${label} must not be empty`;

export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, 'ids are 1-128 characters of letters, digits, . _ : -');

export const addressSchema = z
  .string()
  .regex(/^(lane|brain):[A-Za-z0-9._:-]{1,128}$/, 'address must be lane:<id> or brain:<id>');

const bodySchema = bytes(LIMITS.bodyBytes, 'body').refine(notBlank('body'));
const pathSchema = z.string().min(1).max(LIMITS.pathChars);

export const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: pathSchema }),
  z.object({ kind: z.literal('screenshot'), ref: pathSchema }),
]);

export const jobStateSchema = z.enum(JOB_STATES);

/** Argument schema per operation. The `describe()` texts double as MCP parameter docs. */
export const opArgs = {
  claim_job: z.object({
    jobId: idSchema.optional().describe('Job to claim. Omit to take the oldest ready job in your project.'),
  }),
  complete_job: z.object({
    jobId: idSchema,
    summary: bytes(LIMITS.summaryBytes, 'summary')
      .refine(notBlank('summary'))
      .describe('What you did and how you verified it. The reviewer and the done log read this.'),
    artifacts: z
      .array(pathSchema)
      .max(LIMITS.artifacts)
      .default([])
      .describe('Paths (inside the project or evidence dir) that prove the work: screenshots, logs, reports.'),
  }),
  block_job: z.object({
    jobId: idSchema,
    reason: z.string().min(1).max(LIMITS.reasonChars).describe('What is blocking you and what would unblock it.'),
  }),
  send_message: z.object({
    to: addressSchema.describe('lane:<id> for another lane, brain:<id> for a Brain session.'),
    body: bodySchema,
    attachments: z.array(attachmentSchema).max(LIMITS.attachments).default([]),
  }),
  read_inbox: z.object({
    limit: z.number().int().min(1).max(200).default(50),
    address: addressSchema.optional().describe('Brain only: inbox to read. Defaults to your own.'),
  }),
  list_jobs: z.object({
    states: z.array(jobStateSchema).max(JOB_STATES.length).optional().describe('Only jobs in these states.'),
    mine: z.boolean().default(false).describe('Only jobs held by this lane.'),
    projectId: idSchema.optional().describe("Brain only. Defaults to this session's project."),
    laneId: idSchema.optional().describe('Only jobs held by this lane id.'),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  add_note: z.object({
    body: bodySchema,
    jobId: idSchema.optional().describe('Attach the note to a job. Omit for a project-wide note.'),
    projectId: idSchema.optional().describe("Brain only. Defaults to this session's project."),
  }),
  create_job: z.object({
    title: z.string().trim().min(1).max(LIMITS.titleChars),
    body: bytes(LIMITS.bodyBytes, 'body').default(''),
    projectId: idSchema.optional().describe("Defaults to this session's project."),
    dependsOn: z.array(idSchema).max(100).default([]).describe('Job ids that must be done before this one is ready.'),
    gates: z
      .array(z.string().min(1).max(64))
      .max(10)
      .optional()
      .describe('Verification gates to run on completion, e.g. ["tests", "screenshot", "reviewer"].'),
    kind: z.enum(['work', 'review']).optional(),
    paths: z.array(pathSchema).max(100).optional().describe('Files the job will touch; used for routing.'),
  }),
  link_jobs: z.object({
    from: idSchema.describe('The prerequisite job.'),
    to: idSchema.describe('The job that must wait for `from` to be done.'),
  }),
  assign_job: z.object({ jobId: idSchema, laneId: idSchema }),
  requeue_job: z.object({ jobId: idSchema }),
  list_lanes: z.object({ projectId: idSchema.optional() }),
  broadcast: z.object({
    body: bodySchema,
    projectId: idSchema.optional().describe("Defaults to this session's project."),
    attachments: z.array(attachmentSchema).max(LIMITS.attachments).default([]),
  }),
} as const;

export type BrainOp = keyof typeof opArgs;
export type BrainOpArgs<O extends BrainOp> = z.output<(typeof opArgs)[O]>;
export type BrainOpInput<O extends BrainOp> = z.input<(typeof opArgs)[O]>;

/** Operations a lane may call. */
export const LANE_OPS = [
  'claim_job',
  'complete_job',
  'block_job',
  'send_message',
  'read_inbox',
  'list_jobs',
  'add_note',
] as const satisfies readonly BrainOp[];

/** Operations a Brain session may call. Brains assign jobs; they do not claim them. */
export const BRAIN_OPS = [
  'complete_job',
  'block_job',
  'send_message',
  'read_inbox',
  'list_jobs',
  'add_note',
  'create_job',
  'link_jobs',
  'assign_job',
  'requeue_job',
  'list_lanes',
  'broadcast',
] as const satisfies readonly BrainOp[];

/** Argument fields only meaningful for the brain role; the lane tool surface hides them. */
export const BRAIN_ONLY_FIELDS: Partial<Record<BrainOp, readonly string[]>> = {
  read_inbox: ['address'],
  list_jobs: ['projectId'],
  add_note: ['projectId'],
};

const request = <O extends BrainOp>(op: O) =>
  z.object({ v: z.literal(BRAIN_PROTOCOL_VERSION), op: z.literal(op), args: opArgs[op] });

export const brainRequestSchema = z.discriminatedUnion('op', [
  request('claim_job'),
  request('complete_job'),
  request('block_job'),
  request('send_message'),
  request('read_inbox'),
  request('list_jobs'),
  request('add_note'),
  request('create_job'),
  request('link_jobs'),
  request('assign_job'),
  request('requeue_job'),
  request('list_lanes'),
  request('broadcast'),
]);

/** What a sender builds (defaults may be omitted). */
export type BrainRequest = z.input<typeof brainRequestSchema>;
/** What the executor sees after validation (defaults applied). */
export type ParsedBrainRequest = z.output<typeof brainRequestSchema>;

export const BRAIN_ERROR_CODES = [
  // Raised by the Brain itself (BrainErrorCode).
  'ILLEGAL_TRANSITION',
  'NOT_FOUND',
  'FORBIDDEN',
  'CYCLE',
  'INVALID',
  // Transport and envelope failures.
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'UNAVAILABLE',
  'INTERNAL',
] as const;
export type BrainResponseErrorCode = (typeof BRAIN_ERROR_CODES)[number];

export const brainErrorSchema = z.object({ code: z.enum(BRAIN_ERROR_CODES), message: z.string() });

export const brainResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: brainErrorSchema }),
]);

export type BrainResponse = z.output<typeof brainResponseSchema>;

export function brainFailure(code: BrainResponseErrorCode, message: string): BrainResponse {
  return { ok: false, error: { code, message } };
}

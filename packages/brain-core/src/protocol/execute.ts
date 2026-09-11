import { z } from 'zod';
import type { Brain } from '../brain/brain';
import { InvalidInputError, isBrainError } from '../errors';
import type { Attachment, Identity, ProjectId } from '../types';
import { type BrainResponse, type ParsedBrainRequest, brainFailure, brainRequestSchema } from './ops';
import { resolveAttachmentPath } from './paths';
import { jobDetail, jobSummary, messageView } from './results';

/**
 * What a token grants (SEC-02): who the caller is, its default project, where
 * its attachments may live, and optionally the run it belongs to. Main holds
 * these in its `TokenRegistry`; nothing in a request can change them.
 */
export interface BrainGrant {
  identity: Identity;
  projectId: ProjectId | null;
  attachmentRoots: readonly string[];
  runId?: string;
}

export interface ExecuteOptions {
  /** Receives unexpected errors for main's logs. The caller only ever sees a bare INTERNAL. */
  onInternalError?: (error: unknown) => void;
}

/**
 * Validates and runs one request against a Brain. Never throws: malformed
 * input, Brain rule violations and unexpected bugs all come back as
 * `{ ok: false }`. This is the single implementation of every operation.
 */
export function executeBrainRequest(
  brain: Brain,
  grant: BrainGrant,
  input: unknown,
  options: ExecuteOptions = {}
): BrainResponse {
  const parsed = brainRequestSchema.safeParse(input);
  if (!parsed.success) return brainFailure('BAD_REQUEST', z.prettifyError(parsed.error));
  try {
    return { ok: true, result: run(brain, grant, parsed.data) };
  } catch (error) {
    return errorResponse(error, options);
  }
}

/**
 * SEC-07: Brain errors keep their code and message (written for agents).
 * Anything else becomes a bare INTERNAL: no stack, file path or SQL.
 */
export function errorResponse(error: unknown, options: ExecuteOptions = {}): BrainResponse {
  if (isBrainError(error)) return brainFailure(error.code, error.message);
  options.onInternalError?.(error);
  return brainFailure('INTERNAL', 'internal error');
}

function run(brain: Brain, grant: BrainGrant, request: ParsedBrainRequest): unknown {
  const me = grant.identity;
  const resolve = (p: string) => resolveAttachmentPath(p, grant.attachmentRoots);
  const attach = (items: Attachment[]): Attachment[] =>
    items.map((item) =>
      item.kind === 'file' ? { kind: 'file', path: resolve(item.path) } : { kind: 'screenshot', ref: resolve(item.ref) }
    );
  const project = (requested: ProjectId | undefined): ProjectId => {
    const projectId = requested ?? grant.projectId;
    if (!projectId) throw new InvalidInputError('projectId is required: this session has no default project');
    return projectId;
  };

  switch (request.op) {
    case 'whoami': {
      const run = grant.runId ? { runId: grant.runId } : {};
      return me.role === 'lane'
        ? { role: 'lane', laneId: me.laneId, projectId: grant.projectId, ...run }
        : { role: 'brain', brainId: me.brainId, projectId: grant.projectId, ...run };
    }
    case 'claim_job': {
      const { jobId } = request.args;
      if (jobId) return jobDetail(brain.claimJob(me, jobId, { start: true }));
      // Take the oldest ready job; if another lane wins a race for it, try the next.
      for (const job of brain.listJobs(me, { states: ['ready'] })) {
        try {
          return jobDetail(brain.claimJob(me, job.id, { start: true }));
        } catch (error) {
          if (!isBrainError(error) || error.code !== 'ILLEGAL_TRANSITION') throw error;
        }
      }
      return { claimed: null, message: 'No ready jobs in this project. Check read_inbox, or wait.' };
    }
    case 'complete_job': {
      const { jobId, summary, artifacts } = request.args;
      return jobSummary(brain.completeJob(me, jobId, { summary, artifacts: artifacts.map(resolve) }));
    }
    case 'block_job':
      return jobSummary(brain.blockJob(me, request.args.jobId, request.args.reason));
    case 'send_message': {
      const { to, body, attachments } = request.args;
      const message = brain.sendMessage(me, { to, body, attachments: attach(attachments) });
      return { id: message.id, to: message.to, delivered: true };
    }
    case 'read_inbox':
      return brain.readInbox(me, { limit: request.args.limit, address: request.args.address }).map(messageView);
    case 'list_jobs': {
      const { states, mine, projectId, laneId, limit } = request.args;
      const holder = mine && me.role === 'lane' ? me.laneId : laneId;
      return brain
        .listJobs(me, { states, limit, laneId: holder, projectId: projectId ?? grant.projectId ?? undefined })
        .map(jobSummary);
    }
    case 'add_note': {
      const { body, jobId, projectId } = request.args;
      const note = brain.addNote(me, { body, jobId, projectId: projectId ?? grant.projectId ?? undefined });
      return { id: note.id, projectId: note.projectId, jobId: note.jobId };
    }
    case 'create_job': {
      const { title, body, projectId, dependsOn, gates, kind, paths } = request.args;
      return jobSummary(
        brain.createJob(me, {
          projectId: project(projectId),
          title,
          body,
          dependsOn,
          gateSpec: gates ? { gates } : null,
          hints: { ...(kind ? { kind } : {}), ...(paths ? { paths } : {}) },
        })
      );
    }
    case 'link_jobs':
      return brain.linkJobs(me, request.args.from, request.args.to);
    case 'assign_job':
      return jobSummary(brain.assignJob(me, request.args.jobId, request.args.laneId));
    case 'requeue_job':
      return jobSummary(brain.requeueJob(me, request.args.jobId));
    case 'list_lanes':
      return brain.listLanes(me, { projectId: request.args.projectId ?? grant.projectId ?? undefined });
    case 'broadcast': {
      const { body, projectId, attachments } = request.args;
      return brain
        .broadcast(me, { projectId: project(projectId), body, attachments: attach(attachments) })
        .map((message) => message.to);
    }
  }
}

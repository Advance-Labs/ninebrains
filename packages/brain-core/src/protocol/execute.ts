import { z } from 'zod';
import type { Brain } from '../brain/brain';
import { InvalidInputError, isBrainError } from '../errors';
import type { Attachment, Identity, ProjectId } from '../types';
import {
  type BrainResponse,
  type ParsedBrainRequest,
  brainFailure,
  brainRequestSchema,
  isHostOp,
} from './ops';
import { resolveAttachmentPath } from './paths';
import { jobDetail, jobSummary, messageView } from './results';
import { authorizeRequest } from './scope';

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
  /**
   * v0.1 has no global Brain grant: a brain-role token acts only inside `projectId` (M3, see
   * `scope.ts`). The field exists as a type only; `false` is its one legal value.
   */
  global?: false;
  /**
   * M5: this token belongs to the human operator's CLI, not to an agent. Only main
   * sets it, when it mints the token; nothing in a request can reach it. It widens
   * the op allowlist to `USER_OPS` and lifts the project pin (see `scope.ts`).
   * A user grant is always a brain grant with `brainId` `USER_BRAIN_ID`.
   */
  user?: true;
}

export interface ExecuteOptions {
  /** Receives unexpected errors for main's logs. The caller only ever sees a bare INTERNAL. */
  onInternalError?: (error: unknown) => void;
  /**
   * The project of a live Brain session by brainId, or undefined when no such Brain exists.
   * `send_message` and `read_inbox` refuse Brains that are unknown or in another project (L1).
   * `startBrainHttpServer` derives it from its token registry.
   */
  resolveBrainProject?: (brainId: string) => ProjectId | null | undefined;
  /**
   * Implements the host operations (`HOST_OPS`): the controls that spawn provider
   * CLIs, pause dispatch and latch the global STOP. brain-core owns the DAG and
   * the store, not processes, so the app supplies these. Absent means the ops
   * answer UNAVAILABLE; they are never silently skipped.
   */
  host?: BrainHostOps;
}

/**
 * The app-side half of the user-role surface. Every method may throw a
 * `BrainError` for an expected failure; anything else becomes a bare INTERNAL
 * (SEC-07), as it does for the DAG ops. Results are passed through to the
 * caller as-is, so their shapes stay owned by the app, not by brain-core.
 */
export interface BrainHostOps {
  listDone(projectId: ProjectId, limit: number): Promise<unknown>;
  listNotes(projectId: ProjectId, limit: number): Promise<unknown>;
  dispatcherStatus(): Promise<unknown>;
  setDispatcherPaused(paused: boolean): Promise<unknown>;
  setLaneMode(laneId: string, mode: 'attended' | 'unattended'): Promise<unknown>;
  listSessions(): Promise<unknown>;
  startBrain(projectId: ProjectId): Promise<unknown>;
  stopBrain(brainId: string): Promise<unknown>;
  stopAll(): Promise<unknown>;
  clearStop(): Promise<unknown>;
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
  const prepared = prepare(brain, grant, input, options);
  if ('response' in prepared) return prepared.response;
  if (isHostOp(prepared.request.op)) {
    return brainFailure('UNAVAILABLE', `${prepared.request.op} needs the async executor`);
  }
  try {
    return { ok: true, result: run(brain, grant, prepared.request) };
  } catch (error) {
    return errorResponse(error, options);
  }
}

/**
 * The executor the endpoint uses. Identical to `executeBrainRequest` for every
 * DAG operation, and additionally serves the host operations through
 * `options.host`. Like the sync form, it never throws.
 */
export async function executeBrainRequestAsync(
  brain: Brain,
  grant: BrainGrant,
  input: unknown,
  options: ExecuteOptions = {}
): Promise<BrainResponse> {
  const prepared = prepare(brain, grant, input, options);
  if ('response' in prepared) return prepared.response;
  const request = prepared.request;
  if (!isHostOp(request.op)) {
    try {
      return { ok: true, result: run(brain, grant, request) };
    } catch (error) {
      return errorResponse(error, options);
    }
  }
  const host = options.host;
  if (!host) {
    return brainFailure('UNAVAILABLE', `${request.op} is not available on this endpoint`);
  }
  try {
    return { ok: true, result: await runHost(host, grant, request) };
  } catch (error) {
    return errorResponse(error, options);
  }
}

/** Parses and authorizes, or yields the response to send. Shared by both executors. */
function prepare(
  brain: Brain,
  grant: BrainGrant,
  input: unknown,
  options: ExecuteOptions
): { request: ParsedBrainRequest } | { response: BrainResponse } {
  const parsed = brainRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { response: brainFailure('BAD_REQUEST', z.prettifyError(parsed.error)) };
  }
  try {
    authorizeRequest(brain, grant, parsed.data, options);
  } catch (error) {
    return { response: errorResponse(error, options) };
  }
  return { request: parsed.data };
}

async function runHost(
  host: BrainHostOps,
  grant: BrainGrant,
  request: ParsedBrainRequest
): Promise<unknown> {
  const project = (requested: ProjectId | undefined): ProjectId => {
    const projectId = requested ?? grant.projectId;
    if (!projectId) {
      throw new InvalidInputError('projectId is required: this session has no default project');
    }
    return projectId;
  };
  switch (request.op) {
    case 'list_done':
      return host.listDone(project(request.args.projectId), request.args.limit);
    case 'list_notes':
      return host.listNotes(project(request.args.projectId), request.args.limit);
    case 'dispatcher_status':
      return host.dispatcherStatus();
    case 'set_dispatcher_paused':
      return host.setDispatcherPaused(request.args.paused);
    case 'set_lane_mode':
      return host.setLaneMode(request.args.laneId, request.args.mode);
    case 'list_sessions':
      return host.listSessions();
    case 'start_brain':
      return host.startBrain(project(request.args.projectId));
    case 'stop_brain':
      return host.stopBrain(request.args.brainId);
    case 'stop_all':
      return host.stopAll();
    case 'clear_stop':
      return host.clearStop();
    default:
      throw new InvalidInputError(`${request.op} is not a host operation`);
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
      item.kind === 'file'
        ? { kind: 'file', path: resolve(item.path) }
        : { kind: 'screenshot', ref: resolve(item.ref) }
    );
  const project = (requested: ProjectId | undefined): ProjectId => {
    const projectId = requested ?? grant.projectId;
    if (!projectId)
      throw new InvalidInputError('projectId is required: this session has no default project');
    return projectId;
  };

  switch (request.op) {
    case 'whoami': {
      const run = grant.runId ? { runId: grant.runId } : {};
      if (me.role === 'lane') {
        return { role: 'lane', laneId: me.laneId, projectId: grant.projectId, ...run };
      }
      if (grant.user) return { role: 'user', brainId: me.brainId, projectId: null, ...run };
      return { role: 'brain', brainId: me.brainId, projectId: grant.projectId, ...run };
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
      return {
        claimed: null,
        message: 'No ready jobs in this project. Check read_inbox, or wait.',
      };
    }
    case 'complete_job': {
      const { jobId, summary, artifacts } = request.args;
      return jobSummary(
        brain.completeJob(me, jobId, { summary, artifacts: artifacts.map(resolve) })
      );
    }
    case 'block_job':
      return jobSummary(brain.blockJob(me, request.args.jobId, request.args.reason));
    case 'send_message': {
      const { to, body, attachments } = request.args;
      const message = brain.sendMessage(me, { to, body, attachments: attach(attachments) });
      return { id: message.id, to: message.to, delivered: true };
    }
    case 'read_inbox':
      return brain
        .readInbox(me, { limit: request.args.limit, address: request.args.address })
        .map(messageView);
    case 'list_jobs': {
      const { states, mine, projectId, laneId, limit } = request.args;
      const holder = mine && me.role === 'lane' ? me.laneId : laneId;
      return brain
        .listJobs(me, {
          states,
          limit,
          laneId: holder,
          projectId: projectId ?? grant.projectId ?? undefined,
        })
        .map(jobSummary);
    }
    case 'add_note': {
      const { body, jobId, projectId } = request.args;
      const note = brain.addNote(me, {
        body,
        jobId,
        projectId: projectId ?? grant.projectId ?? undefined,
      });
      return { id: note.id, projectId: note.projectId, jobId: note.jobId };
    }
    case 'create_job': {
      const { title, body, projectId, dependsOn, gates, gateKind, kind, paths } = request.args;
      return jobSummary(
        brain.createJob(me, {
          projectId: project(projectId),
          title,
          body,
          dependsOn,
          // scope.ts has already refused a kind that would weaken the floor (SEC-08).
          gateSpec:
            gates || gateKind
              ? { gates: gates ?? [], ...(gateKind ? { kind: gateKind } : {}) }
              : null,
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
      return brain.listLanes(me, {
        projectId: request.args.projectId ?? grant.projectId ?? undefined,
      });
    case 'broadcast': {
      const { body, projectId, attachments } = request.args;
      return brain
        .broadcast(me, { projectId: project(projectId), body, attachments: attach(attachments) })
        .map((message) => message.to);
    }
  }
}

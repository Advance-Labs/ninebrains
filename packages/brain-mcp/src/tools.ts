import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  type Attachment,
  type Brain,
  InvalidInputError,
  type Job,
  isBrainError,
} from '@ninebrains/brain-core';
import type { z } from 'zod';
import type { BrainMcpConfig } from './config';
import { resolveAttachmentPath } from './paths';
import { shapes } from './schemas';

export const LANE_TOOLS = [
  'claim_job',
  'complete_job',
  'block_job',
  'send_message',
  'read_inbox',
  'list_jobs',
  'add_note',
] as const;

export const BRAIN_TOOLS = [
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
] as const;

type Shape = Record<string, z.ZodType>;
type Args<S extends Shape> = { [K in keyof S]: z.output<S[K]> };

const PREVIEW_CHARS = 280;

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Errors come back as tool results the agent can read, never as protocol failures. */
function fail(error: unknown): CallToolResult {
  const text = isBrainError(error)
    ? `${error.code}: ${error.message}`
    : `INTERNAL: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: 'text', text }] };
}

function summary(job: Job) {
  return {
    id: job.id,
    title: job.title,
    state: job.state,
    laneId: job.laneId,
    attempts: job.attempts,
    ...(job.reason ? { reason: job.reason } : {}),
    body: job.body.length > PREVIEW_CHARS ? `${job.body.slice(0, PREVIEW_CHARS)}...` : job.body,
  };
}

function full(job: Job) {
  return {
    id: job.id,
    title: job.title,
    body: job.body,
    state: job.state,
    attempts: job.attempts,
    gates: job.gateSpec?.gates ?? [],
    hints: job.hints,
    ...(job.reason ? { reason: job.reason } : {}),
  };
}

export function registerTools(server: McpServer, brain: Brain, config: BrainMcpConfig): void {
  const me = config.identity;
  const isBrain = me.role === 'brain';

  function tool<S extends Shape>(
    name: string,
    description: string,
    shape: S,
    handler: (args: Args<S>) => unknown,
    readOnly = false
  ): void {
    const callback = async (args: Args<S>): Promise<CallToolResult> => {
      try {
        return ok(handler(args));
      } catch (error) {
        return fail(error);
      }
    };
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, openWorldHint: false } },
      callback as never
    );
  }

  const attach = (items: Attachment[]): Attachment[] =>
    items.map((item) =>
      item.kind === 'file'
        ? { kind: 'file', path: resolveAttachmentPath(item.path, config.attachmentRoots) }
        : { kind: 'screenshot', ref: resolveAttachmentPath(item.ref, config.attachmentRoots) }
    );

  const project = (requested: string | undefined): string => {
    const projectId = requested ?? config.projectId;
    if (!projectId) throw new InvalidInputError('projectId is required (no NINEBRAINS_PROJECT_ID is set)');
    return projectId;
  };

  if (!isBrain) {
    tool(
      'claim_job',
      'Claim a ready job in your project and start working on it. Pass jobId to take a specific job, or omit it to take the oldest ready job. A job can be held by only one lane: if another lane got it first you receive ILLEGAL_TRANSITION, so pick another. Returns the full job (title, body, gates). When you finish, call complete_job; if you cannot finish, call block.',
      shapes.claimJob,
      ({ jobId }) => {
        if (jobId) return full(brain.claimJob(me, jobId, { start: true }));
        for (const job of brain.listJobs(me, { states: ['ready'] })) {
          try {
            return full(brain.claimJob(me, job.id, { start: true }));
          } catch (error) {
            if (!isBrainError(error) || error.code !== 'ILLEGAL_TRANSITION') throw error;
          }
        }
        return { claimed: null, message: 'No ready jobs in this project. Check read_inbox, or wait.' };
      }
    );
  }

  tool(
    'complete_job',
    'Report a job you hold as finished. It moves to "verifying": gates (tests, screenshots, a reviewer) now check your work. If a gate fails, the feedback arrives in your inbox and the job comes back to you; after 3 failed attempts it is blocked. summary: what changed and how you verified it. artifacts: paths to evidence (screenshots, logs, reports) inside the project or evidence directory.',
    shapes.completeJob,
    ({ jobId, summary: text, artifacts }) => {
      const resolved = artifacts.map((p) => resolveAttachmentPath(p, config.attachmentRoots));
      return summary(brain.completeJob(me, jobId, { summary: text, artifacts: resolved }));
    }
  );

  tool(
    'block_job',
    'Stop work on a job you hold because you cannot proceed (missing access, unclear requirement, broken dependency). The Brain is notified and can requeue it. Say exactly what would unblock you.',
    shapes.block,
    ({ jobId, reason }) => summary(brain.blockJob(me, jobId, reason))
  );

  tool(
    'send_message',
    'Send a message to another lane (lane:<id>) or to a Brain session (brain:<id>). It is stored until the recipient reads it, even if that lane is asleep. Attach files as {"kind":"file","path":...} or screenshots as {"kind":"screenshot","ref":...}; paths must be inside the project or evidence directory.',
    shapes.sendMessage,
    ({ to, body, attachments }) => {
      const message = brain.sendMessage(me, { to, body, attachments: attach(attachments as Attachment[]) });
      return { id: message.id, to: message.to, delivered: true };
    }
  );

  if (isBrain) {
    tool(
      'read_inbox',
      'Read unread messages in your Brain inbox (or, with address, any lane or brain inbox), oldest first, and mark them read.',
      shapes.readInboxBrain,
      ({ limit, address }) => brain.readInbox(me, { limit, address: address as never }),
      false
    );
    tool(
      'list_jobs',
      'List jobs, filtered by project, lane and state. States: proposed (waiting on dependencies), ready, claimed, running, verifying, done, blocked, failed. Bodies are truncated.',
      shapes.listJobsBrain,
      ({ states, projectId, laneId, limit }) =>
        brain.listJobs(me, { states, projectId: projectId ?? config.projectId ?? undefined, laneId, limit }).map(summary),
      true
    );
  } else {
    tool(
      'read_inbox',
      'Read your unread messages, oldest first, and mark them read. Check it when you start, after you complete a job, and whenever you are told you have mail: the Brain sends instructions and gate feedback here.',
      shapes.readInbox,
      ({ limit }) => brain.readInbox(me, { limit })
    );
    tool(
      'list_jobs',
      'List jobs in your project. Filter by states (proposed = waiting on dependencies, ready = claimable, claimed/running = held by a lane, verifying = being checked, done, blocked, failed) or mine=true for jobs you hold. Bodies are truncated; claim_job returns the full body.',
      shapes.listJobs,
      ({ states, mine, limit }) =>
        brain.listJobs(me, { states, limit, laneId: mine && me.role === 'lane' ? me.laneId : undefined }).map(summary),
      true
    );
  }

  tool(
    'add_note',
    'Leave a durable note for your project or one job: a discovery, a gotcha, a decision. Other lanes and the Brain can read notes. Use send_message instead when someone has to act.',
    shapes.addNote,
    ({ body, jobId }) => {
      const note = brain.addNote(me, { body, jobId, projectId: config.projectId ?? undefined });
      return { id: note.id, projectId: note.projectId, jobId: note.jobId };
    }
  );

  if (!isBrain) return;

  tool(
    'create_job',
    'Create a job. With dependsOn it stays "proposed" until every dependency is done, then becomes "ready" and the dispatcher hands it to a free lane. gates picks the verification that runs on completion. kind "review" plus paths help routing (reviews prefer a different model than the author).',
    shapes.createJob,
    ({ title, body, projectId, dependsOn, gates, kind, paths }) =>
      summary(
        brain.createJob(me, {
          projectId: project(projectId),
          title,
          body,
          dependsOn,
          gateSpec: gates ? { gates } : null,
          hints: { ...(kind ? { kind } : {}), ...(paths ? { paths } : {}) },
        })
      )
  );

  tool(
    'link_jobs',
    'Make job `to` wait until job `from` is done. Idempotent. Rejected, with the cycle path, if it would create a dependency cycle.',
    shapes.linkJobs,
    ({ from, to }) => brain.linkJobs(me, from, to)
  );

  tool(
    'assign_job',
    'Hand a ready job to a specific lane in the same project, instead of letting the dispatcher route it.',
    shapes.assignJob,
    ({ jobId, laneId }) => summary(brain.assignJob(me, jobId, laneId))
  );

  tool(
    'requeue_job',
    'Put a blocked or failed job back in the queue with a fresh 3-attempt budget. Read its reason first (list_jobs) and fix the cause or message the lane.',
    shapes.requeueJob,
    ({ jobId }) => summary(brain.requeueJob(me, jobId))
  );

  tool(
    'list_lanes',
    'List lanes with their status (idle, running, waiting, verifying, blocked, asleep), provider (claude or codex) and the job they hold.',
    shapes.listLanes,
    ({ projectId }) => brain.listLanes(me, { projectId: projectId ?? config.projectId ?? undefined }),
    true
  );

  tool(
    'broadcast',
    'Send one message to every lane in a project.',
    shapes.broadcast,
    ({ body, projectId, attachments }) =>
      brain
        .broadcast(me, { projectId: project(projectId), body, attachments: attach(attachments as Attachment[]) })
        .map((m) => m.to)
  );
}

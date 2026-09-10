import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  type Attachment,
  type Brain,
  InvalidInputError,
  type Task,
  isBrainError,
} from '@ninebrains/brain-core';
import type { z } from 'zod';
import type { BrainMcpConfig } from './config';
import { resolveAttachmentPath } from './paths';
import { shapes } from './schemas';

export const LANE_TOOLS = [
  'claim_task',
  'complete_task',
  'block',
  'send_message',
  'read_inbox',
  'list_tasks',
  'add_note',
] as const;

export const BRAIN_TOOLS = [
  'complete_task',
  'block',
  'send_message',
  'read_inbox',
  'list_tasks',
  'add_note',
  'create_task',
  'link_tasks',
  'assign_task',
  'requeue_task',
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

function summary(task: Task) {
  return {
    id: task.id,
    title: task.title,
    state: task.state,
    laneId: task.laneId,
    attempts: task.attempts,
    ...(task.reason ? { reason: task.reason } : {}),
    body: task.body.length > PREVIEW_CHARS ? `${task.body.slice(0, PREVIEW_CHARS)}...` : task.body,
  };
}

function full(task: Task) {
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    state: task.state,
    attempts: task.attempts,
    gates: task.gateSpec?.gates ?? [],
    hints: task.hints,
    ...(task.reason ? { reason: task.reason } : {}),
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
      'claim_task',
      'Claim a ready task in your project and start working on it. Pass taskId to take a specific task, or omit it to take the oldest ready task. A task can be held by only one lane: if another lane got it first you receive ILLEGAL_TRANSITION, so pick another. Returns the full task (title, body, gates). When you finish, call complete_task; if you cannot finish, call block.',
      shapes.claimTask,
      ({ taskId }) => {
        if (taskId) return full(brain.claimTask(me, taskId, { start: true }));
        for (const task of brain.listTasks(me, { states: ['ready'] })) {
          try {
            return full(brain.claimTask(me, task.id, { start: true }));
          } catch (error) {
            if (!isBrainError(error) || error.code !== 'ILLEGAL_TRANSITION') throw error;
          }
        }
        return { claimed: null, message: 'No ready tasks in this project. Check read_inbox, or wait.' };
      }
    );
  }

  tool(
    'complete_task',
    'Report a task you hold as finished. It moves to "verifying": gates (tests, screenshots, a reviewer) now check your work. If a gate fails, the feedback arrives in your inbox and the task comes back to you; after 3 failed attempts it is blocked. summary: what changed and how you verified it. artifacts: paths to evidence (screenshots, logs, reports) inside the project or evidence directory.',
    shapes.completeTask,
    ({ taskId, summary: text, artifacts }) => {
      const resolved = artifacts.map((p) => resolveAttachmentPath(p, config.attachmentRoots));
      return summary(brain.completeTask(me, taskId, { summary: text, artifacts: resolved }));
    }
  );

  tool(
    'block',
    'Stop work on a task you hold because you cannot proceed (missing access, unclear requirement, broken dependency). The Brain is notified and can requeue it. Say exactly what would unblock you.',
    shapes.block,
    ({ taskId, reason }) => summary(brain.blockTask(me, taskId, reason))
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
      'list_tasks',
      'List tasks, filtered by project, lane and state. States: proposed (waiting on dependencies), ready, claimed, running, verifying, done, blocked, failed. Bodies are truncated.',
      shapes.listTasksBrain,
      ({ states, projectId, laneId, limit }) =>
        brain.listTasks(me, { states, projectId: projectId ?? config.projectId ?? undefined, laneId, limit }).map(summary),
      true
    );
  } else {
    tool(
      'read_inbox',
      'Read your unread messages, oldest first, and mark them read. Check it when you start, after you complete a task, and whenever you are told you have mail: the Brain sends instructions and gate feedback here.',
      shapes.readInbox,
      ({ limit }) => brain.readInbox(me, { limit })
    );
    tool(
      'list_tasks',
      'List tasks in your project. Filter by states (proposed = waiting on dependencies, ready = claimable, claimed/running = held by a lane, verifying = being checked, done, blocked, failed) or mine=true for tasks you hold. Bodies are truncated; claim_task returns the full body.',
      shapes.listTasks,
      ({ states, mine, limit }) =>
        brain.listTasks(me, { states, limit, laneId: mine && me.role === 'lane' ? me.laneId : undefined }).map(summary),
      true
    );
  }

  tool(
    'add_note',
    'Leave a durable note for your project or one task: a discovery, a gotcha, a decision. Other lanes and the Brain can read notes. Use send_message instead when someone has to act.',
    shapes.addNote,
    ({ body, taskId }) => {
      const note = brain.addNote(me, { body, taskId, projectId: config.projectId ?? undefined });
      return { id: note.id, projectId: note.projectId, taskId: note.taskId };
    }
  );

  if (!isBrain) return;

  tool(
    'create_task',
    'Create a task. With dependsOn it stays "proposed" until every dependency is done, then becomes "ready" and the dispatcher hands it to a free lane. gates picks the verification that runs on completion. kind "review" plus paths help routing (reviews prefer a different model than the author).',
    shapes.createTask,
    ({ title, body, projectId, dependsOn, gates, kind, paths }) =>
      summary(
        brain.createTask(me, {
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
    'link_tasks',
    'Make task `to` wait until task `from` is done. Idempotent. Rejected, with the cycle path, if it would create a dependency cycle.',
    shapes.linkTasks,
    ({ from, to }) => brain.linkTasks(me, from, to)
  );

  tool(
    'assign_task',
    'Hand a ready task to a specific lane in the same project, instead of letting the dispatcher route it.',
    shapes.assignTask,
    ({ taskId, laneId }) => summary(brain.assignTask(me, taskId, laneId))
  );

  tool(
    'requeue_task',
    'Put a blocked or failed task back in the queue with a fresh 3-attempt budget. Read its reason first (list_tasks) and fix the cause or message the lane.',
    shapes.requeueTask,
    ({ taskId }) => summary(brain.requeueTask(me, taskId))
  );

  tool(
    'list_lanes',
    'List lanes with their status (idle, running, waiting, verifying, blocked, asleep), provider (claude or codex) and the task they hold.',
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

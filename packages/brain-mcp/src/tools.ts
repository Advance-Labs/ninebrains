import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  BRAIN_ONLY_FIELDS,
  BRAIN_OPS,
  BRAIN_PROTOCOL_VERSION,
  type BrainOp,
  type BrainRequest,
  type BrainResponse,
  LANE_OPS,
  opArgs,
} from '@ninebrains/brain-core';
import type { z } from 'zod';
import type { BrainBackend } from './backend';
import type { Role } from './config';

export const LANE_TOOLS = LANE_OPS;
export const BRAIN_TOOLS = BRAIN_OPS;

const READ_ONLY = new Set<BrainOp>(['list_jobs', 'list_lanes']);

/** What the agent reads. Written for the model: when to call, what happens, what to do next. */
const DESCRIPTIONS: Record<BrainOp, (role: Role) => string> = {
  claim_job: () =>
    'Claim a ready job in your project and start working on it. Pass jobId to take a specific job, or omit it to take the oldest ready job. A job can be held by only one lane: if another lane got it first you receive ILLEGAL_TRANSITION, so pick another. Returns the full job (title, body, gates). When you finish, call complete_job; if you cannot finish, call block_job.',
  complete_job: () =>
    'Report a job you hold as finished. It moves to "verifying": gates (tests, screenshots, a reviewer) now check your work. If a gate fails, the feedback arrives in your inbox and the job comes back to you; after 3 failed attempts it is blocked. summary: what changed and how you verified it. artifacts: paths to evidence (screenshots, logs, reports) inside the project or evidence directory.',
  block_job: () =>
    'Stop work on a job you hold because you cannot proceed (missing access, unclear requirement, broken dependency). The Brain is notified and can requeue it. Say exactly what would unblock you.',
  send_message: () =>
    'Send a message to another lane (lane:<id>) or to a Brain session (brain:<id>). It is stored until the recipient reads it, even if that lane is asleep. Attach files as {"kind":"file","path":...} or screenshots as {"kind":"screenshot","ref":...}; paths must be inside the project or evidence directory.',
  read_inbox: (role) =>
    role === 'brain'
      ? 'Read unread messages in your Brain inbox (or, with address, any lane or brain inbox), oldest first, and mark them read. Lanes report progress and problems here.'
      : 'Read your unread messages, oldest first, and mark them read. Check it when you start, after you complete a job, and whenever you are told you have mail: the Brain sends instructions and gate feedback here.',
  list_jobs: (role) =>
    role === 'brain'
      ? 'List jobs, filtered by project, lane and state. States: proposed (waiting on dependencies), ready, claimed, running, verifying, done, blocked, failed. Bodies are truncated.'
      : 'List jobs in your project. Filter by states (proposed = waiting on dependencies, ready = claimable, claimed/running = held by a lane, verifying = being checked, done, blocked, failed) or mine=true for jobs you hold. Bodies are truncated; claim_job returns the full body.',
  add_note: () =>
    'Leave a durable note for your project or one job: a discovery, a gotcha, a decision. Other lanes and the Brain can read notes. Use send_message instead when someone has to act.',
  create_job: () =>
    'Create a job. With dependsOn it stays "proposed" until every dependency is done, then becomes "ready" and the dispatcher hands it to a free lane. gates picks the verification that runs on completion. kind "review" plus paths help routing (reviews prefer a different model than the author).',
  link_jobs: () =>
    'Make job `to` wait until job `from` is done. Idempotent. Rejected, with the cycle path, if it would create a dependency cycle.',
  assign_job: () => 'Hand a ready job to a specific lane in the same project, instead of letting the dispatcher route it.',
  requeue_job: () =>
    'Put a blocked or failed job back in the queue with a fresh 3-attempt budget. Read its reason first (list_jobs) and fix the cause or message the lane.',
  list_lanes: () =>
    'List lanes with their status (idle, running, waiting, verifying, blocked, asleep), provider (claude or codex) and the job they hold.',
  broadcast: () => 'Send one message to every lane in a project at once.',
};

/** Brain errors come back as readable tool errors (`CODE: message`), never as protocol failures. */
export function toToolResult(response: BrainResponse): CallToolResult {
  if (response.ok) return { content: [{ type: 'text', text: JSON.stringify(response.result, null, 2) }] };
  return { isError: true, content: [{ type: 'text', text: `${response.error.code}: ${response.error.message}` }] };
}

function inputShape(op: BrainOp, role: Role): z.ZodRawShape {
  const schema = opArgs[op] as z.ZodObject;
  const hidden = role === 'lane' ? (BRAIN_ONLY_FIELDS[op] ?? []) : [];
  if (hidden.length === 0) return schema.shape;
  return schema.omit(Object.fromEntries(hidden.map((field) => [field, true])) as never).shape;
}

/**
 * Registers one MCP tool per contract operation the role may call. Each tool
 * is a pass-through: the SDK validates input against the core schema, the
 * backend executes it (in main, or in-process in direct mode).
 */
export function registerTools(server: McpServer, backend: BrainBackend, role: Role): void {
  for (const op of role === 'brain' ? BRAIN_OPS : LANE_OPS) {
    server.registerTool(
      op,
      {
        description: DESCRIPTIONS[op](role),
        inputSchema: inputShape(op, role),
        annotations: { readOnlyHint: READ_ONLY.has(op), openWorldHint: false },
      },
      (async (args: Record<string, unknown>) =>
        toToolResult(await backend.call({ v: BRAIN_PROTOCOL_VERSION, op, args } as BrainRequest))) as never
    );
  }
}

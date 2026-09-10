/**
 * Domain types for the Brain. Everything here is plain data (JSON-safe) so it
 * can cross IPC, the MCP protocol and the SQLite boundary unchanged.
 */

export type JobId = string;
export type LaneId = string;
export type ProjectId = string;
export type BrainId = string;

export const JOB_STATES = [
  'proposed',
  'ready',
  'claimed',
  'running',
  'verifying',
  'done',
  'blocked',
  'failed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const LANE_STATUSES = [
  'idle',
  'running',
  'waiting',
  'verifying',
  'blocked',
  'asleep',
] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];

export const PROVIDERS = ['claude', 'codex'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type RunMode = 'attended' | 'unattended';

/** `lane:<id>` or `brain:<id>`. */
export type Address = `lane:${string}` | `brain:${string}`;

/** Which gates run when the job reaches `verifying`. Interpreted by the gate runner. */
export interface GateSpec {
  gates: string[];
  [option: string]: unknown;
}

/** Optional routing hints consumed by `pickLane`. */
export interface JobHints {
  /** `review` jobs prefer a lane whose provider differs from `authorProvider`. */
  kind?: 'work' | 'review';
  authorProvider?: Provider;
  /** Files or directories the job is expected to touch. */
  paths?: string[];
}

export interface JobResult {
  summary: string;
  artifacts: string[];
}

export interface Job {
  id: JobId;
  projectId: ProjectId;
  title: string;
  body: string;
  state: JobState;
  laneId: LaneId | null;
  /** Failed gate runs so far. Reaching `MAX_ATTEMPTS` blocks the job. */
  attempts: number;
  gateSpec: GateSpec | null;
  hints: JobHints;
  /** Latest `complete_job` report, kept while the job is verified. */
  result: JobResult | null;
  /** Why the job is blocked or failed, if it is. */
  reason: string | null;
  createdBy: Address;
  /** Set when the job came from `compilePlan`: the stable key for idempotent upserts. */
  planId: string | null;
  planNodeId: string | null;
  /** Archived jobs were removed from their plan. They are kept, never deleted. */
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** `to` depends on `from`: `to` cannot become ready until `from` is done. */
export interface JobEdge {
  from: JobId;
  to: JobId;
  projectId: ProjectId;
  planId: string | null;
  createdAt: number;
}

export type Attachment = { kind: 'file'; path: string } | { kind: 'screenshot'; ref: string };

export interface Message {
  id: string;
  from: Address;
  to: Address;
  body: string;
  attachments: Attachment[];
  createdAt: number;
  readAt: number | null;
}

export interface Run {
  id: string;
  jobId: JobId;
  laneId: LaneId;
  mode: RunMode;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  transcriptPath: string | null;
}

export interface Note {
  id: string;
  projectId: ProjectId;
  jobId: JobId | null;
  author: Address;
  body: string;
  createdAt: number;
}

export interface DoneEntry {
  id: string;
  jobId: JobId;
  projectId: ProjectId;
  laneId: LaneId | null;
  summary: string;
  artifacts: string[];
  at: number;
}

export interface Lane {
  id: LaneId;
  projectId: ProjectId;
  provider: Provider;
  status: LaneStatus;
  recentFiles: string[];
  activeJobId: JobId | null;
  updatedAt: number;
}

/**
 * Who is calling. Every Brain operation takes one; the MCP server builds it
 * from its spawn environment so an agent cannot pick its own identity.
 */
export type Identity =
  | { role: 'lane'; laneId: LaneId; projectId: ProjectId }
  | { role: 'brain'; brainId: BrainId };

export function addressOf(identity: Identity): Address {
  return identity.role === 'lane' ? `lane:${identity.laneId}` : `brain:${identity.brainId}`;
}

export function parseAddress(value: string): Address | null {
  const match = /^(lane|brain):([A-Za-z0-9._:-]{1,128})$/.exec(value);
  return match ? (value as Address) : null;
}

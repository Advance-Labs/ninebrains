/**
 * Domain types for the Brain. Everything here is plain data (JSON-safe) so it
 * can cross IPC, the forwarding protocol and the SQLite boundary unchanged.
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

export const ADDRESS_KINDS = ['lane', 'brain'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/**
 * A mailbox address. Structured on purpose: it is never concatenated into a
 * string that could end up in a path. `formatAddress` is for display only.
 */
export interface Address {
  kind: AddressKind;
  id: string;
}

/** Which gates run when the job reaches `verifying`. Interpreted by the gate runner. */
export interface GateSpec {
  gates: string[];
  [option: string]: unknown;
}

/**
 * What the work is, for the app's gate floor: `gateSpec.kind`. The app maps it to default gates
 * (tests and security review for code and UI, screenshots for UI, fact checks for research and SEO,
 * none for docs). brain-core's own `JobKind` is for routing and cannot tell UI work apart.
 */
export const GATE_KINDS = ['code', 'ui', 'research', 'seo', 'docs'] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/**
 * SEC-08: the kinds an agent may declare. Both floors hold everything `code` requires, so an
 * agent can add verification by calling work UI, never drop it by calling code work docs.
 */
export const AGENT_GATE_KINDS = ['code', 'ui'] as const satisfies readonly GateKind[];

export type JobKind = 'work' | 'review';

/** Optional routing hints consumed by `pickLane`. */
export interface JobHints {
  /** `review` jobs prefer a lane whose provider differs from `authorProvider`. */
  kind?: JobKind;
  authorProvider?: Provider;
  /** Files or directories the job is expected to touch. */
  paths?: string[];
}

export const VERIFICATION_STATUSES = ['passed', 'failed', 'unverified'] as const;
/** The gate runner's verdict. `unverified` means no gate applied: it unblocks but is not `passed`. */
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** The latest gate-runner verdict on a job. Written by `recordGateResult`. */
export interface JobVerification {
  status: VerificationStatus;
  /** True only for `passed`. A `done` job with `verified: false` must show an "unverified" badge. */
  verified: boolean;
  /** 1-based attempt this verdict is for. */
  attempt: number;
  /** Absolute path of this attempt's evidence manifest, if the runner stored evidence. */
  evidencePath: string | null;
  at: number;
}

export interface JobResult {
  summary: string;
  artifacts: string[];
  verification?: JobVerification;
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
  /**
   * SEC-09 / gate-feedback provenance: set by main when the body carries content nobody trusted
   * wrote (gate feedback, test output, web text). Lane-written messages are untrusted regardless.
   */
  untrusted?: boolean;
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
 * Who is calling. Every Brain operation takes one. In the app it comes from
 * the token map in main, never from anything the agent sends.
 */
export type Identity =
  | { role: 'lane'; laneId: LaneId; projectId: ProjectId }
  | { role: 'brain'; brainId: BrainId };

/**
 * The brainId the human operator acts under. A user token is a brain grant with
 * `user: true` (see `BrainGrant`): to the DAG the operator is a Brain, so replies
 * route back to `{"kind":"brain","id":"user"}` with no special case anywhere.
 */
export const USER_BRAIN_ID = 'user' as const;

export function laneAddress(id: LaneId): Address {
  return { kind: 'lane', id };
}

export function brainAddress(id: BrainId): Address {
  return { kind: 'brain', id };
}

export function addressOf(identity: Identity): Address {
  return identity.role === 'lane' ? laneAddress(identity.laneId) : brainAddress(identity.brainId);
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Human-readable form for messages and logs. Never parse it back, never use it in a path. */
export function formatAddress(address: Address): string {
  return `${address.kind} ${address.id}`;
}

import type { BrainEvent, StoredBrainEvent } from '../events';
import type {
  Address,
  DoneEntry,
  JobEdge,
  Lane,
  LaneId,
  Message,
  Note,
  ProjectId,
  Run,
  Job,
  JobId,
  JobState,
} from '../types';

export interface JobFilter {
  projectId?: ProjectId;
  states?: readonly JobState[];
  laneId?: LaneId;
  planId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface JobEdgeFilter {
  projectId?: ProjectId;
  from?: JobId;
  to?: JobId;
  planId?: string;
}

export interface MessageFilter {
  to: Address;
  unreadOnly?: boolean;
  limit?: number;
}

export interface RunFilter {
  laneId?: LaneId;
  jobId?: JobId;
  since?: number;
  limit?: number;
}

/**
 * Persistence for the Brain. Implementations are dumb row stores: all rules
 * (legality, authorization, readiness) live in `Brain`, which calls these
 * methods inside `transaction`.
 *
 * Contract every implementation must honour (see `store-contract.test.ts`):
 * - `transaction(fn)` is synchronous and serializable. In SQLite that means
 *   `BEGIN IMMEDIATE`, so a read-then-write inside `fn` cannot race another
 *   process. If `fn` throws, nothing it wrote survives. Nested calls join the
 *   outer transaction.
 * - Reads return copies; mutating a returned object never changes the store.
 * - Ordering: jobs by (createdAt, insertion); messages, notes and done
 *   entries oldest first; runs newest first (so `limit` means "most recent").
 * - `insertEdge` is idempotent on (from, to).
 */
export interface BrainStore {
  transaction<T>(fn: () => T): T;

  getJob(id: JobId): Job | undefined;
  findJobByPlanNode(planId: string, planNodeId: string): Job | undefined;
  listJobs(filter?: JobFilter): Job[];
  insertJob(job: Job): void;
  updateJob(job: Job): void;

  listEdges(filter?: JobEdgeFilter): JobEdge[];
  insertEdge(edge: JobEdge): void;
  deleteEdge(from: JobId, to: JobId): void;

  insertMessage(message: Message): void;
  listMessages(filter: MessageFilter): Message[];
  markMessagesRead(ids: readonly string[], at: number): void;

  insertRun(run: Run): void;
  updateRun(run: Run): void;
  getRun(id: string): Run | undefined;
  listRuns(filter?: RunFilter): Run[];

  insertNote(note: Note): void;
  listNotes(filter?: { projectId?: ProjectId; jobId?: JobId; limit?: number }): Note[];

  insertDone(entry: DoneEntry): void;
  listDone(filter?: { projectId?: ProjectId; limit?: number }): DoneEntry[];

  upsertLane(lane: Lane): void;
  getLane(id: LaneId): Lane | undefined;
  listLanes(filter?: { projectId?: ProjectId }): Lane[];

  /** Appends to the durable event log and returns its sequence number. */
  appendEvent(event: BrainEvent, at: number): number;
  /** Events with `seq > afterSeq`, oldest first. Lets other processes follow changes. */
  readEvents(afterSeq: number, limit?: number): StoredBrainEvent[];

  close(): void;
}

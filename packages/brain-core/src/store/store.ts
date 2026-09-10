import type { BrainEvent, StoredBrainEvent } from '../events';
import type {
  Address,
  DoneEntry,
  Edge,
  Lane,
  LaneId,
  Message,
  Note,
  ProjectId,
  Run,
  Task,
  TaskId,
  TaskState,
} from '../types';

export interface TaskFilter {
  projectId?: ProjectId;
  states?: readonly TaskState[];
  laneId?: LaneId;
  planId?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface EdgeFilter {
  projectId?: ProjectId;
  from?: TaskId;
  to?: TaskId;
  planId?: string;
}

export interface MessageFilter {
  to: Address;
  unreadOnly?: boolean;
  limit?: number;
}

export interface RunFilter {
  laneId?: LaneId;
  taskId?: TaskId;
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
 * - Ordering: tasks by (createdAt, insertion); messages, notes and done
 *   entries oldest first; runs newest first (so `limit` means "most recent").
 * - `insertEdge` is idempotent on (from, to).
 */
export interface BrainStore {
  transaction<T>(fn: () => T): T;

  getTask(id: TaskId): Task | undefined;
  findTaskByPlanNode(planId: string, planNodeId: string): Task | undefined;
  listTasks(filter?: TaskFilter): Task[];
  insertTask(task: Task): void;
  updateTask(task: Task): void;

  listEdges(filter?: EdgeFilter): Edge[];
  insertEdge(edge: Edge): void;
  deleteEdge(from: TaskId, to: TaskId): void;

  insertMessage(message: Message): void;
  listMessages(filter: MessageFilter): Message[];
  markMessagesRead(ids: readonly string[], at: number): void;

  insertRun(run: Run): void;
  updateRun(run: Run): void;
  getRun(id: string): Run | undefined;
  listRuns(filter?: RunFilter): Run[];

  insertNote(note: Note): void;
  listNotes(filter?: { projectId?: ProjectId; taskId?: TaskId; limit?: number }): Note[];

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

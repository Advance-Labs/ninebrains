import { randomUUID } from 'node:crypto';
import { type DispatchState, type PlannedAssignment, dispatchTick } from '../dispatch/tick';
import { InvalidInputError, NotFoundError } from '../errors';
import { BrainEmitter, type StoredBrainEvent } from '../events';
import type { BrainStore, TaskFilter } from '../store/store';
import type {
  Address,
  Attachment,
  DoneEntry,
  Edge,
  Identity,
  Lane,
  LaneId,
  Message,
  Note,
  ProjectId,
  Run,
  RunMode,
  Task,
  TaskId,
} from '../types';
import { LANE_STATUSES, PROVIDERS } from '../types';
import { loadVisibleTask, requireBrain, scopeProject } from './authz';
import { type BrainContext, mutate } from './context';
import { addNote, broadcast, readInbox, sendMessage, type SendMessageInput } from './mailbox';
import { type CompileResult, type PlanInput, compilePlan } from './plan';
import * as tasks from './tasks';

export interface BrainOptions {
  store: BrainStore;
  now?: () => number;
  newId?: () => string;
  /** Called when an event listener throws. Defaults to ignoring it. */
  onListenerError?: (error: unknown) => void;
}

/**
 * The Brain: one facade over the task DAG, state machine, mailbox, runs and
 * lanes. Every call takes the caller's `Identity` and is authorized, then
 * runs as a single store transaction. Events fire after commit on `events`
 * and are also appended to the store's event log for other processes.
 */
export class Brain {
  readonly events: BrainEmitter;
  private readonly ctx: BrainContext;

  constructor(options: BrainOptions) {
    this.events = new BrainEmitter(options.onListenerError);
    this.ctx = {
      store: options.store,
      emitter: this.events,
      now: options.now ?? Date.now,
      newId: options.newId ?? randomUUID,
    };
  }

  get store(): BrainStore {
    return this.ctx.store;
  }

  // --- tasks -----------------------------------------------------------

  createTask(identity: Identity, input: tasks.CreateTaskInput): Task {
    return mutate(this.ctx, (tx) => tasks.createTask(this.ctx, tx, identity, input));
  }

  linkTasks(identity: Identity, from: TaskId, to: TaskId): Edge {
    return mutate(this.ctx, (tx) => tasks.linkTasks(this.ctx, tx, identity, from, to));
  }

  unlinkTasks(identity: Identity, from: TaskId, to: TaskId): void {
    mutate(this.ctx, (tx) => tasks.unlinkTasks(this.ctx, tx, identity, from, to));
  }

  claimTask(identity: Identity, taskId: TaskId, options?: { start?: boolean }): Task {
    return mutate(this.ctx, (tx) => tasks.claimTask(this.ctx, tx, identity, taskId, options));
  }

  assignTask(identity: Identity, taskId: TaskId, laneId: LaneId): Task {
    return mutate(this.ctx, (tx) => tasks.assignTask(this.ctx, tx, identity, taskId, laneId));
  }

  startTask(identity: Identity, taskId: TaskId): Task {
    return mutate(this.ctx, (tx) => tasks.startTask(this.ctx, tx, identity, taskId));
  }

  releaseTask(identity: Identity, taskId: TaskId): Task {
    return mutate(this.ctx, (tx) => tasks.releaseTask(this.ctx, tx, identity, taskId));
  }

  completeTask(identity: Identity, taskId: TaskId, report: { summary: string; artifacts?: string[] }): Task {
    return mutate(this.ctx, (tx) => tasks.completeTask(this.ctx, tx, identity, taskId, report));
  }

  recordGateResult(identity: Identity, taskId: TaskId, outcome: { pass: boolean; feedback?: string }): Task {
    return mutate(this.ctx, (tx) => tasks.recordGateResult(this.ctx, tx, identity, taskId, outcome));
  }

  blockTask(identity: Identity, taskId: TaskId, reason: string): Task {
    return mutate(this.ctx, (tx) => tasks.blockTask(this.ctx, tx, identity, taskId, reason));
  }

  failTask(identity: Identity, taskId: TaskId, reason: string): Task {
    return mutate(this.ctx, (tx) => tasks.failTask(this.ctx, tx, identity, taskId, reason));
  }

  requeueTask(identity: Identity, taskId: TaskId): Task {
    return mutate(this.ctx, (tx) => tasks.requeueTask(this.ctx, tx, identity, taskId));
  }

  compilePlan(identity: Identity, input: PlanInput): CompileResult {
    return mutate(this.ctx, (tx) => compilePlan(this.ctx, tx, identity, input));
  }

  getTask(identity: Identity, taskId: TaskId): Task {
    return loadVisibleTask(this.ctx.store, identity, taskId);
  }

  /** Lanes are always scoped to their own project, whatever filter they pass. */
  listTasks(identity: Identity, filter: TaskFilter = {}): Task[] {
    return this.ctx.store.listTasks({ ...filter, projectId: scopeProject(identity, filter.projectId) });
  }

  listEdges(identity: Identity, filter: { projectId?: ProjectId } = {}): Edge[] {
    return this.ctx.store.listEdges({ projectId: scopeProject(identity, filter.projectId) });
  }

  // --- mailbox & notes ---------------------------------------------------

  sendMessage(identity: Identity, input: SendMessageInput): Message {
    return mutate(this.ctx, (tx) => sendMessage(this.ctx, tx, identity, input));
  }

  broadcast(identity: Identity, input: { projectId: ProjectId; body: string; attachments?: Attachment[] }): Message[] {
    return mutate(this.ctx, (tx) => broadcast(this.ctx, tx, identity, input));
  }

  readInbox(identity: Identity, options?: { address?: Address; limit?: number; includeRead?: boolean }): Message[] {
    return this.ctx.store.transaction(() => readInbox(this.ctx, identity, options));
  }

  addNote(identity: Identity, input: { body: string; taskId?: TaskId; projectId?: ProjectId }): Note {
    return this.ctx.store.transaction(() => addNote(this.ctx, identity, input));
  }

  listNotes(identity: Identity, filter: { projectId?: ProjectId; taskId?: TaskId; limit?: number } = {}): Note[] {
    return this.ctx.store.listNotes({ ...filter, projectId: scopeProject(identity, filter.projectId) });
  }

  listDone(identity: Identity, filter: { projectId?: ProjectId; limit?: number } = {}): DoneEntry[] {
    return this.ctx.store.listDone({ ...filter, projectId: scopeProject(identity, filter.projectId) });
  }

  // --- lanes & runs --------------------------------------------------------

  /** Registers or updates a lane. Owned by the app's main process (brain role). */
  upsertLane(identity: Identity, lane: Omit<Lane, 'updatedAt' | 'recentFiles' | 'activeTaskId'> & Partial<Lane>): Lane {
    requireBrain(identity, 'upsert_lane');
    if (!PROVIDERS.includes(lane.provider)) throw new InvalidInputError(`unknown provider ${lane.provider}`);
    if (!LANE_STATUSES.includes(lane.status)) throw new InvalidInputError(`unknown lane status ${lane.status}`);
    return mutate(this.ctx, (tx) => {
      const previous = this.ctx.store.getLane(lane.id);
      const next: Lane = {
        recentFiles: previous?.recentFiles ?? [],
        activeTaskId: previous?.activeTaskId ?? null,
        ...lane,
        updatedAt: this.ctx.now(),
      };
      this.ctx.store.upsertLane(next);
      tx.raise({ type: 'laneChanged', payload: { lane: next } });
      return next;
    });
  }

  listLanes(identity: Identity, filter: { projectId?: ProjectId } = {}): Lane[] {
    return this.ctx.store.listLanes({ projectId: scopeProject(identity, filter.projectId) });
  }

  /** Records a run start; a claimed task moves to running. */
  startRun(identity: Identity, input: { taskId: TaskId; laneId: LaneId; mode: RunMode; transcriptPath?: string }): Run {
    requireBrain(identity, 'start_run');
    return mutate(this.ctx, (tx) => {
      const task = loadVisibleTask(this.ctx.store, identity, input.taskId);
      const run: Run = {
        id: this.ctx.newId(),
        taskId: input.taskId,
        laneId: input.laneId,
        mode: input.mode,
        startedAt: this.ctx.now(),
        endedAt: null,
        exitCode: null,
        transcriptPath: input.transcriptPath ?? null,
      };
      this.ctx.store.insertRun(run);
      if (task.state === 'claimed') tasks.startTask(this.ctx, tx, identity, task.id);
      return run;
    });
  }

  endRun(identity: Identity, runId: string, outcome: { exitCode: number | null }): Run {
    requireBrain(identity, 'end_run');
    return this.ctx.store.transaction(() => {
      const run = this.ctx.store.getRun(runId);
      if (!run) throw new NotFoundError('run', runId);
      const next: Run = { ...run, endedAt: this.ctx.now(), exitCode: outcome.exitCode };
      this.ctx.store.updateRun(next);
      return next;
    });
  }

  listRuns(identity: Identity, filter: { laneId?: LaneId; taskId?: TaskId; since?: number; limit?: number } = {}): Run[] {
    requireBrain(identity, 'list_runs');
    return this.ctx.store.listRuns(filter);
  }

  // --- dispatch & events -----------------------------------------------

  /** A consistent read of what `dispatchTick` needs, optionally for one project. */
  snapshot(identity: Identity, options: { projectId?: ProjectId; runLimit?: number } = {}): DispatchState {
    requireBrain(identity, 'snapshot');
    return this.ctx.store.transaction(() => ({
      tasks: this.ctx.store.listTasks({ projectId: options.projectId }),
      edges: this.ctx.store.listEdges({ projectId: options.projectId }),
      lanes: this.ctx.store.listLanes({ projectId: options.projectId }),
      runs: this.ctx.store.listRuns({ limit: options.runLimit ?? 200 }),
    }));
  }

  /** Plans (but does not apply) one dispatch round. */
  planDispatch(identity: Identity, options: { projectId?: ProjectId } = {}): PlannedAssignment[] {
    return dispatchTick(this.snapshot(identity, options));
  }

  /** Durable events after `afterSeq`, for processes that did not make the change. */
  readEvents(afterSeq: number, limit?: number): StoredBrainEvent[] {
    return this.ctx.store.readEvents(afterSeq, limit);
  }

  close(): void {
    this.ctx.store.close();
  }
}

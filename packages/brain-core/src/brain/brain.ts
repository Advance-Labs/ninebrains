import { randomUUID } from 'node:crypto';
import { type DispatchState, type PlannedAssignment, dispatchTick } from '../dispatch/tick';
import { InvalidInputError, NotFoundError } from '../errors';
import { BrainEmitter, type StoredBrainEvent } from '../events';
import { assertId } from '../ids';
import type { BrainStore, JobFilter } from '../store/store';
import type {
  Address,
  Attachment,
  DoneEntry,
  JobEdge,
  Identity,
  Lane,
  LaneId,
  Message,
  Note,
  ProjectId,
  Run,
  RunMode,
  Job,
  JobId,
} from '../types';
import { LANE_STATUSES, PROVIDERS } from '../types';
import { loadVisibleJob, requireBrain, scopeProject } from './authz';
import { type BrainContext, type GateFloorResolver, mutate } from './context';
import * as jobs from './jobs';
import { addNote, broadcast, readInbox, sendMessage, type SendMessageInput } from './mailbox';
import { type CompileResult, type PlanInput, compilePlan } from './plan';

export interface BrainOptions {
  store: BrainStore;
  now?: () => number;
  newId?: () => string;
  /** Called when an event listener throws. Defaults to ignoring it. */
  onListenerError?: (error: unknown) => void;
  /** SEC-08: minimum gates per project and job kind, from the app's rigor settings. Defaults to none. */
  resolveGateFloor?: GateFloorResolver;
}

/**
 * The Brain: one facade over the job DAG, state machine, mailbox, runs and
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
      resolveGateFloor: options.resolveGateFloor ?? (() => []),
    };
  }

  get store(): BrainStore {
    return this.ctx.store;
  }

  // --- jobs -----------------------------------------------------------

  createJob(identity: Identity, input: jobs.CreateJobInput): Job {
    return mutate(this.ctx, (tx) => jobs.createJob(this.ctx, tx, identity, input));
  }

  linkJobs(identity: Identity, from: JobId, to: JobId): JobEdge {
    return mutate(this.ctx, (tx) => jobs.linkJobs(this.ctx, tx, identity, from, to));
  }

  unlinkJobs(identity: Identity, from: JobId, to: JobId): void {
    mutate(this.ctx, (tx) => jobs.unlinkJobs(this.ctx, tx, identity, from, to));
  }

  claimJob(identity: Identity, jobId: JobId, options?: { start?: boolean }): Job {
    return mutate(this.ctx, (tx) => jobs.claimJob(this.ctx, tx, identity, jobId, options));
  }

  assignJob(identity: Identity, jobId: JobId, laneId: LaneId): Job {
    return mutate(this.ctx, (tx) => jobs.assignJob(this.ctx, tx, identity, jobId, laneId));
  }

  startJob(identity: Identity, jobId: JobId): Job {
    return mutate(this.ctx, (tx) => jobs.startJob(this.ctx, tx, identity, jobId));
  }

  releaseJob(identity: Identity, jobId: JobId): Job {
    return mutate(this.ctx, (tx) => jobs.releaseJob(this.ctx, tx, identity, jobId));
  }

  completeJob(
    identity: Identity,
    jobId: JobId,
    report: { summary: string; artifacts?: string[] }
  ): Job {
    return mutate(this.ctx, (tx) => jobs.completeJob(this.ctx, tx, identity, jobId, report));
  }

  recordGateResult(identity: Identity, jobId: JobId, outcome: jobs.GateOutcomeInput): Job {
    return mutate(this.ctx, (tx) => jobs.recordGateResult(this.ctx, tx, identity, jobId, outcome));
  }

  blockJob(identity: Identity, jobId: JobId, reason: string): Job {
    return mutate(this.ctx, (tx) => jobs.blockJob(this.ctx, tx, identity, jobId, reason));
  }

  failJob(identity: Identity, jobId: JobId, reason: string): Job {
    return mutate(this.ctx, (tx) => jobs.failJob(this.ctx, tx, identity, jobId, reason));
  }

  requeueJob(identity: Identity, jobId: JobId): Job {
    return mutate(this.ctx, (tx) => jobs.requeueJob(this.ctx, tx, identity, jobId));
  }

  compilePlan(identity: Identity, input: PlanInput): CompileResult {
    return mutate(this.ctx, (tx) => compilePlan(this.ctx, tx, identity, input));
  }

  getJob(identity: Identity, jobId: JobId): Job {
    return loadVisibleJob(this.ctx.store, identity, jobId);
  }

  /** Lanes are always scoped to their own project, whatever filter they pass. */
  listJobs(identity: Identity, filter: JobFilter = {}): Job[] {
    return this.ctx.store.listJobs({
      ...filter,
      projectId: scopeProject(identity, filter.projectId),
    });
  }

  listEdges(identity: Identity, filter: { projectId?: ProjectId } = {}): JobEdge[] {
    return this.ctx.store.listEdges({ projectId: scopeProject(identity, filter.projectId) });
  }

  // --- mailbox & notes ---------------------------------------------------

  sendMessage(identity: Identity, input: SendMessageInput): Message {
    return mutate(this.ctx, (tx) => sendMessage(this.ctx, tx, identity, input));
  }

  broadcast(
    identity: Identity,
    input: { projectId: ProjectId; body: string; attachments?: Attachment[] }
  ): Message[] {
    return mutate(this.ctx, (tx) => broadcast(this.ctx, tx, identity, input));
  }

  readInbox(
    identity: Identity,
    options?: { address?: Address; limit?: number; includeRead?: boolean }
  ): Message[] {
    return this.ctx.store.transaction(() => readInbox(this.ctx, identity, options));
  }

  addNote(identity: Identity, input: { body: string; jobId?: JobId; projectId?: ProjectId }): Note {
    return this.ctx.store.transaction(() => addNote(this.ctx, identity, input));
  }

  listNotes(
    identity: Identity,
    filter: { projectId?: ProjectId; jobId?: JobId; limit?: number } = {}
  ): Note[] {
    return this.ctx.store.listNotes({
      ...filter,
      projectId: scopeProject(identity, filter.projectId),
    });
  }

  listDone(
    identity: Identity,
    filter: { projectId?: ProjectId; limit?: number } = {}
  ): DoneEntry[] {
    return this.ctx.store.listDone({
      ...filter,
      projectId: scopeProject(identity, filter.projectId),
    });
  }

  // --- lanes & runs --------------------------------------------------------

  /** Registers or updates a lane. Owned by the app's main process (brain role). */
  upsertLane(
    identity: Identity,
    lane: Omit<Lane, 'updatedAt' | 'recentFiles' | 'activeJobId'> & Partial<Lane>
  ): Lane {
    requireBrain(identity, 'upsert_lane');
    assertId('lane id', lane.id);
    assertId('projectId', lane.projectId);
    if (!PROVIDERS.includes(lane.provider))
      throw new InvalidInputError(`unknown provider ${lane.provider}`);
    if (!LANE_STATUSES.includes(lane.status))
      throw new InvalidInputError(`unknown lane status ${lane.status}`);
    return mutate(this.ctx, (tx) => {
      const previous = this.ctx.store.getLane(lane.id);
      const next: Lane = {
        recentFiles: previous?.recentFiles ?? [],
        activeJobId: previous?.activeJobId ?? null,
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

  /** Records a run start; a claimed job moves to running. */
  startRun(
    identity: Identity,
    input: { jobId: JobId; laneId: LaneId; mode: RunMode; transcriptPath?: string }
  ): Run {
    requireBrain(identity, 'start_run');
    return mutate(this.ctx, (tx) => {
      const job = loadVisibleJob(this.ctx.store, identity, input.jobId);
      const run: Run = {
        id: this.ctx.newId(),
        jobId: input.jobId,
        laneId: input.laneId,
        mode: input.mode,
        startedAt: this.ctx.now(),
        endedAt: null,
        exitCode: null,
        transcriptPath: input.transcriptPath ?? null,
      };
      this.ctx.store.insertRun(run);
      if (job.state === 'claimed') jobs.startJob(this.ctx, tx, identity, job.id);
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

  listRuns(
    identity: Identity,
    filter: { laneId?: LaneId; jobId?: JobId; since?: number; limit?: number } = {}
  ): Run[] {
    requireBrain(identity, 'list_runs');
    return this.ctx.store.listRuns(filter);
  }

  // --- dispatch & events -----------------------------------------------

  /** A consistent read of what `dispatchTick` needs, optionally for one project. */
  snapshot(
    identity: Identity,
    options: { projectId?: ProjectId; runLimit?: number } = {}
  ): DispatchState {
    requireBrain(identity, 'snapshot');
    return this.ctx.store.transaction(() => ({
      jobs: this.ctx.store.listJobs({ projectId: options.projectId }),
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

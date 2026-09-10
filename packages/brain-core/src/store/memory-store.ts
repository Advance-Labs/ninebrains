import type { BrainEvent, StoredBrainEvent } from '../events';
import { NotFoundError } from '../errors';
import type { DoneEntry, JobEdge, Lane, LaneId, Message, Note, ProjectId, Run, Job, JobId } from '../types';
import { sameAddress } from '../types';
import type { BrainStore, JobEdgeFilter, MessageFilter, RunFilter, JobFilter } from './store';

interface State {
  jobs: Job[];
  edges: JobEdge[];
  messages: Message[];
  runs: Run[];
  notes: Note[];
  done: DoneEntry[];
  lanes: Lane[];
  events: StoredBrainEvent[];
  seq: number;
}

const clone = <T>(value: T): T => structuredClone(value);

function take<T>(rows: T[], limit: number | undefined): T[] {
  return limit === undefined ? rows : rows.slice(0, limit);
}

/**
 * In-process store for tests and ephemeral sessions. Transactions snapshot
 * the whole state and restore it if the callback throws.
 */
export class InMemoryBrainStore implements BrainStore {
  private state: State = {
    jobs: [],
    edges: [],
    messages: [],
    runs: [],
    notes: [],
    done: [],
    lanes: [],
    events: [],
    seq: 0,
  };
  private depth = 0;

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    const snapshot = clone(this.state);
    this.depth = 1;
    try {
      const result = fn();
      if (result instanceof Promise) throw new TypeError('transaction callbacks must be synchronous');
      return result;
    } catch (error) {
      this.state = snapshot;
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getJob(id: JobId): Job | undefined {
    const job = this.state.jobs.find((t) => t.id === id);
    return job && clone(job);
  }

  findJobByPlanNode(planId: string, planNodeId: string): Job | undefined {
    const job = this.state.jobs.find((t) => t.planId === planId && t.planNodeId === planNodeId);
    return job && clone(job);
  }

  listJobs(filter: JobFilter = {}): Job[] {
    const rows = this.state.jobs.filter(
      (t) =>
        (filter.projectId === undefined || t.projectId === filter.projectId) &&
        (filter.states === undefined || filter.states.includes(t.state)) &&
        (filter.laneId === undefined || t.laneId === filter.laneId) &&
        (filter.planId === undefined || t.planId === filter.planId) &&
        (filter.includeArchived || t.archivedAt === null)
    );
    const sorted = rows
      .map((t, i) => ({ t, i }))
      .sort((a, b) => a.t.createdAt - b.t.createdAt || a.i - b.i)
      .map(({ t }) => t);
    return clone(take(sorted, filter.limit));
  }

  insertJob(job: Job): void {
    if (this.state.jobs.some((t) => t.id === job.id)) throw new Error(`duplicate job ${job.id}`);
    this.state.jobs.push(clone(job));
  }

  updateJob(job: Job): void {
    const index = this.state.jobs.findIndex((t) => t.id === job.id);
    if (index < 0) throw new NotFoundError('job', job.id);
    this.state.jobs[index] = clone(job);
  }

  listEdges(filter: JobEdgeFilter = {}): JobEdge[] {
    return clone(
      this.state.edges.filter(
        (e) =>
          (filter.projectId === undefined || e.projectId === filter.projectId) &&
          (filter.from === undefined || e.from === filter.from) &&
          (filter.to === undefined || e.to === filter.to) &&
          (filter.planId === undefined || e.planId === filter.planId)
      )
    );
  }

  insertEdge(edge: JobEdge): void {
    if (this.state.edges.some((e) => e.from === edge.from && e.to === edge.to)) return;
    this.state.edges.push(clone(edge));
  }

  deleteEdge(from: JobId, to: JobId): void {
    this.state.edges = this.state.edges.filter((e) => !(e.from === from && e.to === to));
  }

  insertMessage(message: Message): void {
    this.state.messages.push(clone(message));
  }

  listMessages(filter: MessageFilter): Message[] {
    const rows = this.state.messages.filter(
      (m) => sameAddress(m.to, filter.to) && (!filter.unreadOnly || m.readAt === null)
    );
    return clone(take(rows, filter.limit));
  }

  markMessagesRead(ids: readonly string[], at: number): void {
    const wanted = new Set(ids);
    for (const m of this.state.messages) if (wanted.has(m.id) && m.readAt === null) m.readAt = at;
  }

  insertRun(run: Run): void {
    this.state.runs.push(clone(run));
  }

  updateRun(run: Run): void {
    const index = this.state.runs.findIndex((r) => r.id === run.id);
    if (index < 0) throw new NotFoundError('run', run.id);
    this.state.runs[index] = clone(run);
  }

  getRun(id: string): Run | undefined {
    const run = this.state.runs.find((r) => r.id === id);
    return run && clone(run);
  }

  listRuns(filter: RunFilter = {}): Run[] {
    const rows = this.state.runs
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) =>
          (filter.laneId === undefined || r.laneId === filter.laneId) &&
          (filter.jobId === undefined || r.jobId === filter.jobId) &&
          (filter.since === undefined || r.startedAt >= filter.since)
      )
      .sort((a, b) => b.r.startedAt - a.r.startedAt || b.i - a.i)
      .map(({ r }) => r);
    return clone(take(rows, filter.limit));
  }

  insertNote(note: Note): void {
    this.state.notes.push(clone(note));
  }

  listNotes(filter: { projectId?: ProjectId; jobId?: JobId; limit?: number } = {}): Note[] {
    const rows = this.state.notes.filter(
      (n) =>
        (filter.projectId === undefined || n.projectId === filter.projectId) &&
        (filter.jobId === undefined || n.jobId === filter.jobId)
    );
    return clone(take(rows, filter.limit));
  }

  insertDone(entry: DoneEntry): void {
    this.state.done.push(clone(entry));
  }

  listDone(filter: { projectId?: ProjectId; limit?: number } = {}): DoneEntry[] {
    const rows = this.state.done.filter(
      (d) => filter.projectId === undefined || d.projectId === filter.projectId
    );
    return clone(take(rows, filter.limit));
  }

  upsertLane(lane: Lane): void {
    const index = this.state.lanes.findIndex((l) => l.id === lane.id);
    if (index < 0) this.state.lanes.push(clone(lane));
    else this.state.lanes[index] = clone(lane);
  }

  getLane(id: LaneId): Lane | undefined {
    const lane = this.state.lanes.find((l) => l.id === id);
    return lane && clone(lane);
  }

  listLanes(filter: { projectId?: ProjectId } = {}): Lane[] {
    return clone(
      this.state.lanes.filter((l) => filter.projectId === undefined || l.projectId === filter.projectId)
    );
  }

  appendEvent(event: BrainEvent, at: number): number {
    const seq = ++this.state.seq;
    this.state.events.push(clone({ ...event, seq, at }) as StoredBrainEvent);
    return seq;
  }

  readEvents(afterSeq: number, limit = 500): StoredBrainEvent[] {
    return clone(this.state.events.filter((e) => e.seq > afterSeq).slice(0, limit));
  }

  close(): void {}
}

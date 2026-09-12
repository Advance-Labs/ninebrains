import { cell, type Cell } from '@emdash/wire/state';
import type { Brain, DoneEntry, Job, Note } from '@ninebrains/brain-core';
import {
  addressKey,
  type BrainAddress,
  type BrainDispatcherView,
  type BrainDoneView,
  type BrainJobView,
  type BrainNoteView,
  type BrainSessionView,
  type BrainUnread,
} from '../api';
import { APP_IDENTITY } from './dispatcher';
import { isVerified } from './verification';

export interface PanelCells {
  jobs: Cell<BrainJobView[]>;
  done: Cell<BrainDoneView[]>;
  notes: Cell<BrainNoteView[]>;
}

const LIST_LIMIT = 200;

export function jobView(job: Job): BrainJobView {
  return {
    id: job.id,
    projectId: job.projectId,
    title: job.title,
    state: job.state,
    laneId: job.laneId,
    attempts: job.attempts,
    reason: job.reason,
    gates: job.gateSpec?.gates ?? [],
    createdByBrain: job.createdBy.kind === 'brain' ? job.createdBy.id : null,
    updatedAt: job.updatedAt,
  };
}

export function noteView(note: Note): BrainNoteView {
  return {
    id: note.id,
    projectId: note.projectId,
    jobId: note.jobId,
    author: note.author,
    body: note.body,
    at: note.createdAt,
  };
}

export function doneView(brain: Brain, entry: DoneEntry, notes: readonly Note[]): BrainDoneView {
  const job = brain.store.getJob(entry.jobId);
  return {
    id: entry.id,
    jobId: entry.jobId,
    title: job?.title ?? entry.jobId,
    projectId: entry.projectId,
    laneId: entry.laneId,
    summary: entry.summary,
    artifacts: entry.artifacts,
    at: entry.at,
    // The gate runner records its verdict on the job; notes are the unwired fallback's record.
    verified: job?.result?.verification?.verified ?? isVerified(notes, entry.jobId),
  };
}

/**
 * Live read models over the Brain DB for the renderer. Cells are created on
 * first request and all of them are recomputed (coalesced) after any Brain
 * event, so the drawer, the side panels and the unread badge stay current.
 */
export class BrainViews {
  readonly unread: Cell<BrainUnread> = cell<BrainUnread>({});
  readonly sessions: Cell<BrainSessionView[]> = cell<BrainSessionView[]>([]);
  readonly dispatcher: Cell<BrainDispatcherView>;
  private readonly projects = new Map<string, PanelCells>();
  private readonly lanes = new Map<string, PanelCells>();
  private scheduled = false;
  private readonly off: () => void;

  constructor(
    private readonly brain: Brain,
    private readonly inboxes: () => BrainAddress[],
    private readonly dispatcherState: () => BrainDispatcherView
  ) {
    this.dispatcher = cell(dispatcherState());
    const offs = (['jobChanged', 'jobBlocked', 'messageSent', 'laneChanged'] as const).map((type) =>
      brain.events.on(type, () => this.schedule())
    );
    this.off = () => offs.forEach((unsubscribe) => unsubscribe());
  }

  dispose(): void {
    this.off();
  }

  project(projectId: string): PanelCells {
    let cells = this.projects.get(projectId);
    if (!cells) {
      cells = emptyPanel();
      this.projects.set(projectId, cells);
      this.fillProject(projectId, cells);
    }
    return cells;
  }

  lanePanel(laneId: string): PanelCells {
    let cells = this.lanes.get(laneId);
    if (!cells) {
      cells = emptyPanel();
      this.lanes.set(laneId, cells);
      this.fillLane(laneId, cells);
    }
    return cells;
  }

  setSessions(sessions: BrainSessionView[]): void {
    this.sessions.set(sessions);
    this.schedule();
  }

  /** Recomputes every live cell on the next microtask. */
  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.refresh();
    });
  }

  refresh(): void {
    for (const [projectId, cells] of this.projects) this.fillProject(projectId, cells);
    for (const [laneId, cells] of this.lanes) this.fillLane(laneId, cells);
    this.dispatcher.set(this.dispatcherState());
    const unread: BrainUnread = {};
    for (const address of this.inboxes()) {
      unread[addressKey(address)] = this.brain.store.listMessages({
        to: address,
        unreadOnly: true,
        limit: 500,
      }).length;
    }
    this.unread.set(unread);
  }

  private fillProject(projectId: string, cells: PanelCells): void {
    const brain = this.brain;
    const notes = brain.listNotes(APP_IDENTITY, { projectId, limit: LIST_LIMIT });
    cells.jobs.set(brain.listJobs(APP_IDENTITY, { projectId, limit: LIST_LIMIT }).map(jobView));
    cells.done.set(
      brain
        .listDone(APP_IDENTITY, { projectId, limit: LIST_LIMIT })
        .map((entry) => doneView(brain, entry, notes))
    );
    cells.notes.set(notes.map(noteView));
  }

  private fillLane(laneId: string, cells: PanelCells): void {
    const brain = this.brain;
    const projectId = brain.store.getLane(laneId)?.projectId;
    if (!projectId) {
      cells.jobs.set([]);
      cells.done.set([]);
      cells.notes.set([]);
      return;
    }
    const jobs = brain.listJobs(APP_IDENTITY, { laneId, limit: LIST_LIMIT });
    const jobIds = new Set(jobs.map((job) => job.id));
    const notes = brain.listNotes(APP_IDENTITY, { projectId, limit: LIST_LIMIT });
    const done = brain
      .listDone(APP_IDENTITY, { projectId, limit: LIST_LIMIT })
      .filter((entry) => entry.laneId === laneId);
    for (const entry of done) jobIds.add(entry.jobId);
    cells.jobs.set(jobs.filter((job) => job.state !== 'done').map(jobView));
    cells.done.set(done.map((entry) => doneView(brain, entry, notes)));
    cells.notes.set(
      notes
        .filter(
          (note) =>
            (note.author.kind === 'lane' && note.author.id === laneId) ||
            (note.jobId !== null && jobIds.has(note.jobId))
        )
        .map(noteView)
    );
  }
}

function emptyPanel(): PanelCells {
  return { jobs: cell<BrainJobView[]>([]), done: cell<BrainDoneView[]>([]), notes: cell([]) };
}

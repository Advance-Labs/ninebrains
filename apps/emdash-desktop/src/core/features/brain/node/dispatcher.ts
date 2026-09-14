import type { Brain, Identity, Job, LaneStatus as BrainLaneStatus } from '@ninebrains/brain-core';
import type { LaneRunMode } from '@core/features/lanes/api';
import { canPaste, type LaneAgentState, type PasteOutcome } from './attended';
import { buildJobPrompt } from './job-prompt';

/** Main's own identity for dispatch bookkeeping. Never minted as a token. */
export const APP_IDENTITY: Identity = { role: 'brain', brainId: 'app' };

const HOLDING_STATES = ['claimed', 'running', 'verifying', 'blocked'] as const;

export interface DispatchLane {
  laneId: string;
  projectId: string;
  provider: 'claude' | 'codex';
  /** The lane's PTY is running (attended lanes need it). */
  sessionRunning: boolean;
  asleep: boolean;
  agent?: LaneAgentState;
  worktreePath: string | null;
  /** The lane's persisted run mode. When present it is authoritative over `setMode`. */
  mode?: LaneRunMode;
  /** The pack role the lane launches with (prompt and servers). */
  roleId?: string;
  /** The lane's model, for unattended runs. */
  model?: string;
  /** Lever A: the lane's subagent tier. Absent: the role's default, else inherit. */
  subagentModel?: string;
  /** Lever B: the model profile the lane runs on. Absent: the user's subscription. */
  authProfileId?: string;
}

export interface DispatcherPorts {
  brain: Brain;
  lanes(): DispatchLane[];
  /** Attended: paste the prompt into the lane's PTY under the SEC-15 rule. */
  paste(lane: DispatchLane, prompt: string): Promise<PasteOutcome>;
  /** Unattended: run the job with `claude -p`. Resolves when the run has ended. */
  runUnattended(lane: DispatchLane, job: Job): Promise<void>;
  onError(context: string, error: unknown): void;
  onChange?(): void;
}

export interface DispatchRecord {
  jobId: string;
  laneId: string;
  mode: LaneRunMode;
  outcome: PasteOutcome | 'started' | 'stale';
}

/**
 * The dispatch loop over `brain.planDispatch` (brain-core `dispatchTick`).
 *
 * Each tick syncs lane availability into the Brain, plans, and applies the plan.
 * Fairness: ready jobs go oldest first, a lane takes at most one job per tick,
 * `pickLane` prefers the least-loaded lane, and a lane with a job in flight (a
 * paste in progress or a run still going) is never idle.
 *
 * Attended lanes get a paste only when the SEC-15 rule allows it; if the paste
 * does not land, the job is released back to `ready`. Unattended lanes run
 * `claude -p` through the exec supervisor. A paused or latched dispatcher plans nothing.
 */
export class Dispatcher {
  private paused = false;
  private latched = false;
  private readonly modes = new Map<string, LaneRunMode>();
  private readonly inFlight = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly ports: DispatcherPorts,
    private readonly options: { intervalMs?: number; debounceMs?: number } = {}
  ) {}

  start(): void {
    const events = this.ports.brain.events;
    const offs = [
      events.on('jobChanged', () => this.schedule()),
      events.on('jobBlocked', () => this.schedule()),
    ];
    this.unsubscribe = () => offs.forEach((off) => off());
    this.interval = setInterval(() => this.schedule(), this.options.intervalMs ?? 1_500);
    this.schedule();
  }

  dispose(): void {
    this.unsubscribe?.();
    if (this.interval) clearInterval(this.interval);
    if (this.scheduled) clearTimeout(this.scheduled);
    this.unsubscribe = this.interval = this.scheduled = null;
  }

  get state() {
    return {
      paused: this.paused,
      stopLatched: this.latched,
      laneModes: Object.fromEntries(this.modes),
      inFlight: this.inFlight.size,
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.ports.onChange?.();
    if (!paused) this.schedule();
  }

  /**
   * Global STOP: refuse all work until `clearStop`. The user's pause is separate state, so a
   * pause set before STOP is still there after Clear STOP (T37).
   */
  latch(): void {
    this.latched = true;
    this.ports.onChange?.();
  }

  clearStop(): void {
    this.latched = false;
    this.ports.onChange?.();
  }

  modeOf(laneId: string): LaneRunMode {
    return this.modes.get(laneId) ?? 'attended';
  }

  setMode(laneId: string, mode: LaneRunMode): void {
    if (mode === 'attended') this.modes.delete(laneId);
    else this.modes.set(laneId, mode);
    this.ports.onChange?.();
    this.schedule();
  }

  /** Adopts each lane's persisted mode, so a restart keeps unattended lanes unattended. */
  private mirrorModes(lanes: Iterable<DispatchLane>): void {
    let changed = false;
    for (const lane of lanes) {
      if (lane.mode === undefined || lane.mode === this.modeOf(lane.laneId)) continue;
      if (lane.mode === 'attended') this.modes.delete(lane.laneId);
      else this.modes.set(lane.laneId, lane.mode);
      changed = true;
    }
    if (changed) this.ports.onChange?.();
  }

  /** Coalesces triggers (brain events, lane status changes, the interval) into one tick. */
  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      void this.tick().catch((error: unknown) =>
        this.ports.onError('brain: dispatch failed', error)
      );
    }, this.options.debounceMs ?? 50);
  }

  /** One serialized round. Returns what it dispatched. */
  tick(): Promise<DispatchRecord[]> {
    const next = this.chain.then(() => this.round());
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async round(): Promise<DispatchRecord[]> {
    if (this.paused || this.latched) return [];
    const { brain } = this.ports;
    const lanes = new Map(this.ports.lanes().map((lane) => [lane.laneId, lane]));
    this.mirrorModes(lanes.values());
    for (const lane of lanes.values()) this.syncLane(lane);

    const records: DispatchRecord[] = [];
    for (const { jobId, laneId } of brain.planDispatch(APP_IDENTITY)) {
      if (this.paused || this.latched) break;
      const lane = lanes.get(laneId);
      if (!lane) continue;
      let job: Job;
      try {
        job = brain.assignJob(APP_IDENTITY, jobId, laneId);
      } catch {
        records.push({ jobId, laneId, mode: this.modeOf(laneId), outcome: 'stale' });
        continue;
      }
      records.push(await this.apply(lane, job));
    }
    return records;
  }

  private async apply(lane: DispatchLane, job: Job): Promise<DispatchRecord> {
    const mode = this.modeOf(lane.laneId);
    const record = { jobId: job.id, laneId: lane.laneId, mode };
    this.inFlight.add(lane.laneId);
    if (mode === 'unattended') {
      void this.ports
        .runUnattended(lane, job)
        .catch((error: unknown) => this.ports.onError('brain: unattended run failed', error))
        .finally(() => this.release(lane.laneId));
      return { ...record, outcome: 'started' };
    }
    let outcome: PasteOutcome;
    try {
      outcome = await this.ports.paste(lane, buildJobPrompt(job));
    } catch (error) {
      this.ports.onError('brain: paste failed', error);
      outcome = 'not-ready';
    }
    const { brain } = this.ports;
    // STOP (T-stop-requeue) can requeue this same job out from under an in-flight paste — it
    // reads the lane's held job fresh and does not wait on this call. If that happened, the job
    // is no longer `claimed` and finishing here would throw; there is nothing left to apply.
    try {
      if (outcome === 'pasted') {
        brain.startRun(APP_IDENTITY, { jobId: job.id, laneId: lane.laneId, mode: 'attended' });
      } else {
        brain.releaseJob(APP_IDENTITY, job.id);
      }
    } catch (error) {
      this.ports.onError('brain: dispatch settle failed', error);
    }
    this.release(lane.laneId);
    return { ...record, outcome };
  }

  private release(laneId: string): void {
    this.inFlight.delete(laneId);
    this.schedule();
  }

  /** Mirrors a lane's availability into the Brain, writing only on change. */
  private syncLane(lane: DispatchLane): void {
    const { brain } = this.ports;
    const held = brain.listJobs(APP_IDENTITY, {
      laneId: lane.laneId,
      states: [...HOLDING_STATES],
      limit: 1,
    })[0];
    const status = this.brainStatus(lane, held);
    const current = brain.store.getLane(lane.laneId);
    if (
      current &&
      current.status === status &&
      current.projectId === lane.projectId &&
      current.provider === lane.provider
    ) {
      return;
    }
    brain.upsertLane(APP_IDENTITY, {
      id: lane.laneId,
      projectId: lane.projectId,
      provider: lane.provider,
      status,
    });
  }

  private brainStatus(lane: DispatchLane, held: Job | undefined): BrainLaneStatus {
    if (lane.asleep) return 'asleep';
    if (held?.state === 'verifying') return 'verifying';
    if (held?.state === 'blocked') return 'blocked';
    if (held || this.inFlight.has(lane.laneId)) return 'running';
    if (this.modeOf(lane.laneId) === 'unattended') return lane.worktreePath ? 'idle' : 'waiting';
    if (!lane.sessionRunning) return 'waiting';
    if (canPaste(lane.agent)) return 'idle';
    return lane.agent?.status === 'working' ? 'running' : 'waiting';
  }
}

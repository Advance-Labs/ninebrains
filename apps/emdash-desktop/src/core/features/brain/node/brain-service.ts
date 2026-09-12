import { err, ok, type Result } from '@emdash/shared';
import {
  CycleError,
  ForbiddenError,
  IllegalTransitionError,
  InvalidInputError,
  NotFoundError,
  type Brain,
  type Identity,
} from '@ninebrains/brain-core';
import type {
  ExecRunResult,
  ExecRunSpec,
  RunBudgets,
} from '@core/features/exec-runs/api/node/types';
import type { LaneConfig, LaneRunMode } from '@core/features/lanes/api';
import type { PackLaunch } from '@core/features/packs/api/launch';
import type { BrainAddress, BrainDispatcherView, BrainError } from '../api';
import { pastePrompt, type LaneAgentState } from './attended';
import { BrainSessions, type BrainSessionPorts } from './brain-sessions';
import { BrainViews, doneView, noteView } from './brain-views';
import { APP_IDENTITY, Dispatcher, type DispatchLane } from './dispatcher';
import { brainLaunchKey, laneLaunchKey, type BrainEndpoint } from './endpoint';
import { brainEvents } from './event-host';
import { removeLaunchDir, sweepLaunchDirs } from './lane-files';
import { buildLaneLaunch, type BrainMcpRuntime, type UpstreamLaunchArgs } from './launch-config';
import { stopEverything } from './stop';
import { DEFAULT_UNATTENDED_BUDGETS, runJobUnattended } from './unattended';
import { startVerification, type GateRunnerPort, type VerificationHandler } from './verification';

/** The user acting in the UI. Lane replies to a user message land in `brain:user`. */
export const USER_IDENTITY: Identity = { role: 'brain', brainId: 'user' };

const BRAIN_MODE_PROMPT = [
  'You are a Ninebrains Brain: you plan and coordinate, you do not write the code yourself.',
  'Break the work into jobs with create_job (use dependsOn for order), and read lane reports with read_inbox.',
  'The app dispatches ready jobs to idle lanes; you do not need to assign them.',
].join(' ');

export type BrainLaneInfo = DispatchLane & { taskId: string; conversationId: string };

/** The lanes side, bound by the composition root from LaneService. */
export interface BrainLanesPort {
  list(): BrainLaneInfo[];
  sendInput(conversationId: string, data: string): Promise<void>;
  stop(laneId: string): Promise<void>;
  /** Persists the lane's run mode with the lane. Throws when the lane does not exist. */
  setMode(laneId: string, mode: LaneRunMode): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** Re-derives lane lights after job state changed. */
  refresh(): void;
}

export interface BrainSupervisorPort {
  run(spec: ExecRunSpec): Promise<ExecRunResult>;
  killAll(): Promise<void>;
  clearStop(): void;
  readonly activeRunIds: string[];
}

export interface BrainServiceDeps {
  brain: Brain;
  endpoint: BrainEndpoint;
  userDataDir: string;
  brainMcp: BrainMcpRuntime;
  lanes: BrainLanesPort;
  sessions: BrainSessionPorts;
  supervisor: BrainSupervisorPort;
  packs?: { resolvePackLaunch(projectId: string, roleId?: string): Promise<PackLaunch> };
  /** For `verification: 'internal'` only; without it a verifying job is marked done unverified. */
  gateRunner?: GateRunnerPort;
  /**
   * `'external'` when the gates slice's runner (`createGatesServices`) owns `verifying` jobs:
   * the internal hand-off then stays off, or the two race (gates README, "Wiring").
   * Default `'internal'`.
   */
  verification?: 'internal' | 'external';
  claudeConfigDir?: string;
  onError(context: string, error: unknown): void;
  sleep?(ms: number): Promise<void>;
  dispatch?: { intervalMs?: number; debounceMs?: number; submitDelayMs?: number };
  unattendedBudgets?: RunBudgets;
}

const brainLaunchId = (brainId: string) => `brain-${brainId}`.slice(0, 64);

/** Pack launches differ by role (prompt, gates), so the cache is per project and role. */
const packCacheKey = (projectId: string, roleId: string | undefined) =>
  `${projectId}|${roleId ?? ''}`;

function toBrainError(error: unknown): BrainError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof NotFoundError) return { type: 'not-found', message };
  if (error instanceof ForbiddenError) return { type: 'forbidden', message };
  if (error instanceof CycleError || error instanceof IllegalTransitionError) {
    return { type: 'conflict', message };
  }
  if (error instanceof InvalidInputError) return { type: 'invalid', message };
  return { type: 'internal', message: 'The Brain could not do that.' };
}

function attempt<T>(onError: BrainServiceDeps['onError'], fn: () => T): Result<T, BrainError> {
  try {
    return ok(fn());
  } catch (error) {
    const mapped = toBrainError(error);
    if (mapped.type === 'internal') onError('brain: operation failed', error);
    return err(mapped);
  }
}

/**
 * The Brain wired into the app (Phase 2): owns the Brain, its endpoint tokens,
 * the dispatcher, the verification hand-off, Brain sessions and the read
 * models, and implements every `brain` wire procedure.
 */
export class BrainService {
  readonly brain: Brain;
  readonly views: BrainViews;
  readonly sessions: BrainSessions;
  readonly dispatcher: Dispatcher;
  private readonly verification: VerificationHandler;
  private readonly packCache = new Map<string, PackLaunch>();
  private readonly offs: Array<() => void> = [];

  constructor(private readonly deps: BrainServiceDeps) {
    this.brain = deps.brain;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.sessions = new BrainSessions(deps.sessions, (brainId) =>
      this.release(brainLaunchKey(brainId), brainLaunchId(brainId))
    );
    // The dispatcher first: the views read its state as soon as they are built.
    this.dispatcher = new Dispatcher(
      {
        brain: deps.brain,
        lanes: () => deps.lanes.list(),
        paste: (lane, prompt) => {
          const info = deps.lanes.list().find((candidate) => candidate.laneId === lane.laneId);
          if (!info) return Promise.resolve('not-ready');
          return pastePrompt(
            {
              state: () => this.agentOf(lane.laneId),
              write: (data) => deps.lanes.sendInput(info.conversationId, data),
              sleep,
            },
            prompt,
            deps.dispatch?.submitDelayMs
          );
        },
        runUnattended: async (lane, job) => {
          await runJobUnattended(
            {
              brain: deps.brain,
              supervisor: deps.supervisor,
              endpoint: deps.endpoint,
              brainMcp: deps.brainMcp,
              pack: (projectId, roleId) => this.pack(projectId, roleId),
              siblingWorktrees: (laneId) => this.siblingWorktrees(laneId),
              budgets: deps.unattendedBudgets,
            },
            lane,
            job
          );
        },
        onError: deps.onError,
        onChange: () => this.views.schedule(),
      },
      deps.dispatch
    );
    this.views = new BrainViews(
      deps.brain,
      () => this.inboxes(),
      () => this.dispatcherView()
    );
    this.verification =
      deps.verification === 'external'
        ? { settled: async () => undefined, dispose: () => undefined }
        : startVerification({
            brain: deps.brain,
            gateRunner: deps.gateRunner,
            onError: deps.onError,
          });
  }

  start(): void {
    sweepLaunchDirs(this.deps.userDataDir);
    const { brain, lanes } = this.deps;
    this.offs.push(
      lanes.subscribe(() => this.dispatcher.schedule()),
      this.sessions.onChange(() => this.views.setSessions(this.sessions.list())),
      brain.events.on('jobChanged', ({ job }) => {
        lanes.refresh();
        brainEvents.emit(undefined, {
          type: 'job-changed',
          jobId: job.id,
          projectId: job.projectId,
          state: job.state,
        });
      }),
      brain.events.on('jobBlocked', ({ job, reason }) =>
        brainEvents.emit(undefined, {
          type: 'job-blocked',
          jobId: job.id,
          projectId: job.projectId,
          reason,
        })
      ),
      brain.events.on('messageSent', ({ message }) =>
        brainEvents.emit(undefined, { type: 'message', messageId: message.id, to: message.to })
      )
    );
    void this.sessions.initialize();
    this.dispatcher.start();
    this.views.refresh();
  }

  async dispose(): Promise<void> {
    this.dispatcher.dispose();
    this.verification.dispose();
    this.views.dispose();
    for (const off of this.offs.splice(0)) off();
    await this.deps.endpoint.close();
  }

  /** Resolves once every queued verification has settled. For tests. */
  verificationSettled(): Promise<void> {
    return this.verification.settled();
  }

  // --- launch (SEAMS §3.7) --------------------------------------------------

  /** `resolveLaneLaunch` for conversations that are Brain sessions (lanes go through LaneService). */
  resolveSessionLaunch(conversationId: string, upstream: UpstreamLaunchArgs & { cwd: string }) {
    const session = this.sessions.byConversation(conversationId);
    if (!session) return undefined;
    const { brainId, projectId } = session;
    return buildLaneLaunch(
      this.launchDeps(),
      {
        launchKey: brainLaunchKey(brainId),
        launchId: brainLaunchId(brainId),
        provider: 'claude',
        worktree: upstream.cwd,
        grant: { identity: { role: 'brain', brainId }, projectId, attachmentRoots: [upstream.cwd] },
        siblingWorktrees: this.siblingWorktrees(null),
        pack: {
          mcpServers: [],
          appendSystemPrompt: BRAIN_MODE_PROMPT,
          defaultGates: [],
          warnings: [],
        },
      },
      upstream
    );
  }

  /** The lanes slice's `LaneBrainPort` (structurally typed; lanes node may not be imported). */
  laneBrainPort() {
    return {
      prepareLaunch: async (lane: LaneConfig) => {
        await this.pack(lane.projectId, lane.roleId);
      },
      resolveLaunch: (lane: LaneConfig, upstream: UpstreamLaunchArgs & { cwd: string }) =>
        buildLaneLaunch(
          this.launchDeps(),
          {
            launchKey: laneLaunchKey(lane.laneId),
            launchId: lane.laneId,
            provider: lane.provider,
            worktree: upstream.cwd,
            grant: {
              identity: { role: 'lane', laneId: lane.laneId, projectId: lane.projectId },
              projectId: lane.projectId,
              attachmentRoots: [upstream.cwd],
            },
            laneHint: lane.laneId,
            siblingWorktrees: this.siblingWorktrees(lane.laneId),
            pack: this.packCache.get(packCacheKey(lane.projectId, lane.roleId)),
          },
          upstream
        ),
      releaseLaunch: (laneId: string) => this.release(laneLaunchKey(laneId), laneId),
      override: (laneId: string) => {
        const held = this.brain.listJobs(APP_IDENTITY, {
          laneId,
          states: ['claimed', 'running', 'verifying', 'blocked'],
          limit: 1,
        })[0];
        if (!held) return undefined;
        const job = held.state === 'verifying' || held.state === 'blocked' ? held.state : undefined;
        return { job, activeJobId: held.id };
      },
    };
  }

  // --- procedures ------------------------------------------------------------

  createJob(input: {
    projectId: string;
    title: string;
    body?: string;
    dependsOn?: string[];
    gates?: string[];
  }) {
    return attempt(this.deps.onError, () => {
      const job = this.brain.createJob(USER_IDENTITY, {
        projectId: input.projectId,
        title: input.title,
        body: input.body,
        dependsOn: input.dependsOn,
        gateSpec: input.gates ? { gates: input.gates } : undefined,
      });
      return { jobId: job.id };
    });
  }

  linkJobs(from: string, to: string) {
    return attempt(this.deps.onError, () => void this.brain.linkJobs(USER_IDENTITY, from, to));
  }

  requeueJob(jobId: string) {
    return attempt(this.deps.onError, () => void this.brain.requeueJob(USER_IDENTITY, jobId));
  }

  sendMessage(input: { fromBrainId: string; to: BrainAddress; body: string }) {
    return attempt(this.deps.onError, () => {
      const from: Identity = { role: 'brain', brainId: input.fromBrainId };
      return { messageId: this.brain.sendMessage(from, { to: input.to, body: input.body }).id };
    });
  }

  readInbox(address: BrainAddress, includeRead = false) {
    return attempt(this.deps.onError, () =>
      this.brain.readInbox(USER_IDENTITY, { address, includeRead, limit: 100 }).map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        body: m.body,
        at: m.createdAt,
        readAt: m.readAt,
        untrusted: m.from.kind === 'lane',
      }))
    );
  }

  listDone(projectId: string, limit = 200) {
    return attempt(this.deps.onError, () => {
      const notes = this.brain.listNotes(APP_IDENTITY, { projectId, limit: 500 });
      return this.brain
        .listDone(APP_IDENTITY, { projectId, limit })
        .map((entry) => doneView(this.brain, entry, notes));
    });
  }

  listNotes(projectId: string, limit = 200) {
    return attempt(this.deps.onError, () =>
      this.brain.listNotes(APP_IDENTITY, { projectId, limit }).map(noteView)
    );
  }

  startBrain(projectId: string) {
    return this.sessions.start(projectId);
  }

  stopBrain(brainId: string) {
    return this.sessions.stop(brainId);
  }

  setDispatcherPaused(paused: boolean): Result<void, BrainError> {
    if (!paused && this.dispatcher.state.stopLatched) {
      return err({ type: 'conflict', message: 'STOP is latched. Clear it first.' });
    }
    this.dispatcher.setPaused(paused);
    return ok(undefined);
  }

  /** Persists the mode with the lane first, so a restart keeps it (the dispatcher mirrors it). */
  async setLaneMode(laneId: string, mode: LaneRunMode): Promise<Result<void, BrainError>> {
    try {
      await this.deps.lanes.setMode(laneId, mode);
    } catch (error) {
      return err({
        type: 'not-found',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.dispatcher.setMode(laneId, mode);
    return ok(undefined);
  }

  private readonly stopListeners = new Set<() => void>();

  /** Fires when STOP latches or clears, from any entry point (renderer, app menu, tray). */
  onStopChange(listener: () => void): () => void {
    this.stopListeners.add(listener);
    return () => this.stopListeners.delete(listener);
  }

  private notifyStop(latched: boolean): void {
    brainEvents.emit(undefined, { type: 'stop', latched });
    for (const listener of this.stopListeners) {
      try {
        listener();
      } catch (error) {
        this.deps.onError('brain: STOP listener failed', error);
      }
    }
  }

  /** Global STOP (SEC-30). Latches until `clearStop`. */
  async stopAll(): Promise<Result<{ killedRuns: number; stoppedLanes: number }, BrainError>> {
    const { supervisor, lanes, onError } = this.deps;
    const result = await stopEverything({
      latch: () => this.dispatcher.latch(),
      killAllRuns: () => supervisor.killAll(),
      activeRunCount: () => supervisor.activeRunIds.length,
      dispatchedAttendedLanes: () =>
        lanes
          .list()
          .filter((lane) => this.dispatcher.modeOf(lane.laneId) === 'attended')
          .filter(
            (lane) =>
              this.brain.listJobs(APP_IDENTITY, {
                laneId: lane.laneId,
                states: ['claimed', 'running'],
                limit: 1,
              }).length > 0
          )
          .map((lane) => lane.laneId),
      stopLane: (laneId) => lanes.stop(laneId),
      onError,
      onStopped: () => {
        this.views.schedule();
        this.notifyStop(true);
      },
    });
    return ok({ killedRuns: result.killedRuns, stoppedLanes: result.stoppedLanes });
  }

  clearStop(): Result<void, BrainError> {
    this.deps.supervisor.clearStop();
    this.dispatcher.clearStop();
    this.dispatcher.setPaused(false);
    this.notifyStop(false);
    return ok(undefined);
  }

  // --- internals ---------------------------------------------------------------

  private launchDeps() {
    return {
      userDataDir: this.deps.userDataDir,
      endpoint: this.deps.endpoint,
      brainMcp: this.deps.brainMcp,
      claudeConfigDir: this.deps.claudeConfigDir,
    };
  }

  private release(launchKey: string, launchId: string): void {
    this.deps.endpoint.revoke(launchKey);
    try {
      removeLaunchDir(this.deps.userDataDir, launchId);
    } catch (error) {
      this.deps.onError('brain: launch cleanup failed', error);
    }
  }

  /** A project's pack launch for one role (or none): its prompt, servers and gates differ. */
  private async pack(projectId: string, roleId?: string): Promise<PackLaunch | undefined> {
    if (!this.deps.packs) return undefined;
    const key = packCacheKey(projectId, roleId);
    try {
      const launch = await this.deps.packs.resolvePackLaunch(projectId, roleId);
      this.packCache.set(key, launch);
      return launch;
    } catch (error) {
      this.deps.onError('brain: pack launch failed', error);
      return this.packCache.get(key);
    }
  }

  private agentOf(laneId: string): LaneAgentState | undefined {
    return this.deps.lanes.list().find((lane) => lane.laneId === laneId)?.agent;
  }

  private siblingWorktrees(laneId: string | null): string[] {
    const lanes = this.deps.lanes
      .list()
      .filter((lane) => lane.laneId !== laneId)
      .flatMap((lane) => (lane.worktreePath ? [lane.worktreePath] : []));
    const sessions = this.sessions
      .ids()
      .flatMap((brainId) => this.sessions.worktreeOf(brainId) ?? []);
    return [...lanes, ...sessions];
  }

  private inboxes(): BrainAddress[] {
    return [
      ...this.deps.lanes.list().map((lane) => ({ kind: 'lane' as const, id: lane.laneId })),
      ...this.sessions.ids().map((id) => ({ kind: 'brain' as const, id })),
      { kind: 'brain', id: 'user' },
    ];
  }

  private dispatcherView(): BrainDispatcherView {
    const state = this.dispatcher.state;
    return {
      paused: state.paused,
      stopLatched: state.stopLatched,
      laneModes: state.laneModes,
      activeRuns: this.deps.supervisor.activeRunIds.length,
      gatesConnected: this.deps.gateRunner !== undefined,
      unattendedBudgets: this.deps.unattendedBudgets ?? DEFAULT_UNATTENDED_BUDGETS,
    };
  }
}

import { err, ok, type Result } from '@emdash/shared';
import { cell, peek, type Cell } from '@emdash/wire/state';
import { MODEL_PROFILES_ENABLED } from '@core/primitives/app-identity/api/fork-flags';
import {
  LANE_SLOT_COUNT,
  SSH_UNSUPPORTED_MESSAGE,
  type Lane,
  type LaneBoard,
  type LaneConfig,
  type LaneError,
  type LaneEvent,
  type LaneProvider,
  type LaneRunMode,
  type LaneSession,
  type LanesGridConfig,
  type LaneSlot,
  type LaneStatusMap,
  type LaneTabConfig,
} from '../api';
import type {
  LaneAgentDetail,
  LaneAgentSnapshot,
  LaneLaunchOverrides,
  LaneProjectInfo,
  LaneServicePorts,
  LaneUpstreamLaunch,
} from './lane-ports';
import { mapLaneSession, mapLaneStatus } from './lane-status';

type LaneRuntime = { session: LaneSession; error: string | null };
type LaneLocation = { tab: LaneTabConfig; slot: LaneSlot; config: LaneConfig };

const EMPTY_SNAPSHOT: LaneAgentSnapshot = { agents: new Map(), sessions: new Map() };

function laneError(type: LaneError['type'], message: string): LaneError {
  return { type, message };
}

const PROFILES_DISABLED = laneError(
  'routing-disabled',
  'Model profiles are off in this build, so the lane stays on your subscription.'
);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Deterministic per-lane branch, so restored lanes can show it without storing it. */
export function laneBranchName(laneId: string): string {
  return `lanes/${laneId.slice(0, 8)}`;
}

function emptySlots(): (LaneConfig | null)[] {
  return Array.from({ length: LANE_SLOT_COUNT }, () => null);
}

/**
 * Owns lane state in main: which lanes exist, where they sit in the grid, and
 * their session facts. A lane = one worktree Task + one PTY Conversation.
 * Sleep only hides a lane; nothing here stops a PTY except stop/relaunch/remove.
 */
export class LaneService {
  readonly board: Cell<LaneBoard> = cell<LaneBoard>({ tabs: [] });
  readonly statuses: Cell<LaneStatusMap> = cell<LaneStatusMap>({});

  private grid: LanesGridConfig = { tabs: [] };
  private readonly runtime = new Map<string, LaneRuntime>();
  private readonly projectNames = new Map<string, string>();
  private snapshot: LaneAgentSnapshot = EMPTY_SNAPSHOT;
  private readonly pending = new Set<Promise<void>>();
  private saveChain: Promise<void> = Promise.resolve();
  private initializing: Promise<void> | null = null;
  private unsubscribeFeed: (() => void) | null = null;
  private readonly worktrees = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly ports: LaneServicePorts,
    private readonly emit: (event: LaneEvent) => void = () => {}
  ) {}

  initialize(): Promise<void> {
    this.initializing ??= this.load();
    return this.initializing;
  }

  dispose(): void {
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
  }

  /** Resolves once every background bring-up has finished. For tests and shutdown. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
    await this.saveChain;
  }

  boardSnapshot(): LaneBoard {
    return peek(this.board);
  }

  statusSnapshot(): LaneStatusMap {
    return peek(this.statuses);
  }

  getLane(laneId: string): Lane | undefined {
    for (const tab of this.boardSnapshot().tabs) {
      const lane = tab.slots.find((candidate) => candidate?.laneId === laneId);
      if (lane) return lane;
    }
    return undefined;
  }

  findLaneByConversation(conversationId: string): Lane | undefined {
    for (const tab of this.boardSnapshot().tabs) {
      const lane = tab.slots.find((candidate) => candidate?.conversationId === conversationId);
      if (lane) return lane;
    }
    return undefined;
  }

  /**
   * Launch hook for `TuiConversationProvider` (SEAMS §3.7): the Brain returns
   * the per-lane `--mcp-config`/`--settings` flags. Non-lane conversations and
   * a service without a Brain launch untouched.
   */
  resolveLaneLaunch(
    conversationId: string,
    upstream?: LaneUpstreamLaunch
  ): LaneLaunchOverrides | undefined {
    if (!this.ports.brain || !upstream) return undefined;
    const lane = this.findConfigByConversation(conversationId);
    if (!lane) return undefined;
    this.worktrees.set(lane.laneId, upstream.cwd);
    return this.ports.brain.resolveLaunch(lane, upstream);
  }

  /** Called after every publish (board, lights). Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-derives the lights, e.g. after a Brain job changed state. */
  refresh(): void {
    this.publish();
  }

  /** Hook state for a conversation, with the detail the paste rule needs. */
  agentStateOf(
    conversationId: string
  ):
    | ({ status: NonNullable<ReturnType<LaneAgentSnapshot['agents']['get']>> } & LaneAgentDetail)
    | undefined {
    const status = this.snapshot.agents.get(conversationId);
    if (!status) return undefined;
    return { status, ...this.snapshot.details?.get(conversationId) };
  }

  /** The lane's worktree, once a session has been provisioned or launched this run. */
  worktreePathOf(laneId: string): string | null {
    return this.worktrees.get(laneId) ?? null;
  }

  async createTab(title?: string): Promise<Result<{ tabId: string }, LaneError>> {
    await this.initialize();
    const tabId = this.ports.newId();
    this.grid.tabs.push({
      tabId,
      title: title?.trim() || `Tab ${this.grid.tabs.length + 1}`,
      slots: emptySlots(),
    });
    this.commit();
    return ok({ tabId });
  }

  async renameTab(tabId: string, title: string): Promise<Result<void, LaneError>> {
    await this.initialize();
    const tab = this.grid.tabs.find((candidate) => candidate.tabId === tabId);
    if (!tab) return err(laneError('tab-not-found', 'That tab no longer exists.'));
    tab.title = title.trim();
    this.commit();
    return ok(undefined);
  }

  async removeTab(tabId: string): Promise<Result<void, LaneError>> {
    await this.initialize();
    const tab = this.grid.tabs.find((candidate) => candidate.tabId === tabId);
    if (!tab) return err(laneError('tab-not-found', 'That tab no longer exists.'));
    if (tab.slots.some(Boolean)) {
      return err(laneError('tab-not-empty', 'Remove or move the lanes in this tab first.'));
    }
    this.grid.tabs = this.grid.tabs.filter((candidate) => candidate !== tab);
    this.commit();
    return ok(undefined);
  }

  async createLane(input: {
    tabId: string;
    slot: LaneSlot;
    projectId: string;
    provider: LaneProvider;
    model?: string;
    roleId?: string;
    subagentModel?: string;
    authProfileId?: string;
  }): Promise<Result<{ laneId: string }, LaneError>> {
    await this.initialize();
    if (input.authProfileId && !this.profilesEnabled) return err(PROFILES_DISABLED);
    const tab = this.grid.tabs.find((candidate) => candidate.tabId === input.tabId);
    if (!tab) return err(laneError('tab-not-found', 'That tab no longer exists.'));
    if (tab.slots[input.slot]) {
      return err(laneError('slot-occupied', 'That slot already has a lane.'));
    }
    const project = await this.ports.projects.get(input.projectId);
    if (!project) return err(laneError('project-not-found', 'That project no longer exists.'));
    if (project.host !== 'local') return err(laneError('ssh-unsupported', SSH_UNSUPPORTED_MESSAGE));
    // The await above yields; re-check the slot before claiming it.
    if (tab.slots[input.slot]) {
      return err(laneError('slot-occupied', 'That slot already has a lane.'));
    }

    const laneId = this.ports.newId();
    const config: LaneConfig = {
      laneId,
      projectId: project.projectId,
      taskId: this.ports.newId(),
      conversationId: this.ports.newId(),
      provider: input.provider,
      model: input.model ?? null,
      accountLabel: null,
      browserId: `lane-${laneId}`,
      asleep: false,
      conversationReady: false,
      ...(input.roleId ? { roleId: input.roleId } : {}),
      ...(input.subagentModel ? { subagentModel: input.subagentModel } : {}),
      ...(input.authProfileId ? { authProfileId: input.authProfileId } : {}),
    };
    tab.slots[input.slot] = config;
    this.projectNames.set(project.projectId, project.name);
    this.runtime.set(laneId, { session: 'starting', error: null });
    this.commit();
    this.emit({ type: 'lane-added', laneId, tabId: tab.tabId, slot: input.slot });
    this.track(this.bringUp(config, project, input.slot));
    return ok({ laneId });
  }

  async startLane(laneId: string): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    const session = this.sessionOf(location.config);
    if (session === 'running' || session === 'starting') return ok(undefined);
    return this.startSession(laneId);
  }

  async stopLane(laneId: string): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    try {
      await this.ports.conversations.stop(location.config.conversationId);
    } catch (error) {
      return err(laneError('stop-failed', messageOf(error)));
    }
    this.ports.brain?.releaseLaunch(laneId);
    this.setRuntime(laneId, { session: 'stopped', error: null });
    return ok(undefined);
  }

  async relaunchLane(laneId: string): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    if (location.config.conversationReady) {
      const stopped = await this.stopLane(laneId);
      if (!stopped.success) return stopped;
    }
    return this.startSession(laneId);
  }

  async sleepLane(laneId: string): Promise<Result<void, LaneError>> {
    return this.setAsleep(laneId, true);
  }

  async wakeLane(laneId: string): Promise<Result<void, LaneError>> {
    return this.setAsleep(laneId, false);
  }

  /** Persists how the Brain hands this lane its jobs. Attended is stored as no field. */
  async setLaneMode(laneId: string, mode: LaneRunMode): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    if (mode === 'unattended') location.config.runMode = 'unattended';
    else delete location.config.runMode;
    this.commit();
    return ok(undefined);
  }

  async removeLane(laneId: string, deleteWorktree: boolean): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    const { config, tab, slot } = location;
    if (config.conversationReady) {
      try {
        await this.ports.conversations.stop(config.conversationId);
      } catch (error) {
        this.ports.onError('lanes: stop on remove failed', error);
      }
    }
    this.ports.brain?.releaseLaunch(laneId);
    tab.slots[slot] = null;
    this.runtime.delete(laneId);
    this.worktrees.delete(laneId);
    this.commit();
    this.emit({ type: 'lane-removed', laneId });
    if (deleteWorktree) {
      try {
        await this.ports.tasks.deleteTask(config.projectId, config.taskId, {
          deleteWorktree: true,
        });
      } catch (error) {
        this.ports.onError('lanes: worktree delete failed', error);
      }
    }
    return ok(undefined);
  }

  async moveLane(laneId: string, tabId: string, slot: LaneSlot): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    const target = this.grid.tabs.find((candidate) => candidate.tabId === tabId);
    if (!target) return err(laneError('tab-not-found', 'That tab no longer exists.'));
    const displaced = target.slots[slot];
    target.slots[slot] = location.config;
    location.tab.slots[location.slot] = displaced === location.config ? location.config : displaced;
    this.commit();
    this.emit({ type: 'lane-moved', laneId, tabId, slot });
    if (displaced && displaced !== location.config) {
      this.emit({
        type: 'lane-moved',
        laneId: displaced.laneId,
        tabId: location.tab.tabId,
        slot: location.slot,
      });
    }
    return ok(undefined);
  }

  /**
   * Lever A tier and Lever B auth mode (docs/plans/2026-09-12-model-routing.md). Stored with
   * the lane and used from its next launch; `null` clears a field. An explicit `inherit` is
   * kept, so it overrides a role's default.
   */
  async setLaneRouting(
    laneId: string,
    routing: { subagentModel: string | null; authProfileId: string | null }
  ): Promise<Result<void, LaneError>> {
    await this.initialize();
    if (routing.authProfileId && !this.profilesEnabled) return err(PROFILES_DISABLED);
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    const { config } = location;
    if (routing.subagentModel === null) delete config.subagentModel;
    else config.subagentModel = routing.subagentModel;
    if (routing.authProfileId === null) delete config.authProfileId;
    else config.authProfileId = routing.authProfileId;
    this.commit();
    return ok(undefined);
  }

  private get profilesEnabled(): boolean {
    return this.ports.modelProfilesEnabled ?? MODEL_PROFILES_ENABLED;
  }

  private async load(): Promise<void> {
    try {
      const persisted = await this.ports.persistence.load();
      if (persisted) this.grid = structuredClone(persisted);
    } catch (error) {
      this.ports.onError('lanes: failed to load the lanes grid', error);
    }
    if (this.grid.tabs.length === 0) {
      this.grid.tabs.push({ tabId: this.ports.newId(), title: 'Tab 1', slots: emptySlots() });
      this.persist();
    }
    this.unsubscribeFeed = this.ports.agentFeed.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.publish();
    });
    this.publish();
    await this.loadProjectNames();
  }

  private async loadProjectNames(): Promise<void> {
    const projectIds = new Set(
      this.grid.tabs.flatMap((tab) => tab.slots.flatMap((lane) => (lane ? [lane.projectId] : [])))
    );
    await Promise.all(
      [...projectIds].map(async (projectId) => {
        try {
          const project = await this.ports.projects.get(projectId);
          if (project) this.projectNames.set(projectId, project.name);
        } catch (error) {
          this.ports.onError('lanes: project lookup failed', error);
        }
      })
    );
    this.publish();
  }

  private async bringUp(config: LaneConfig, project: LaneProjectInfo, slot: LaneSlot) {
    const created = await this.ports.tasks.createWorktreeTask({
      taskId: config.taskId,
      projectId: project.projectId,
      name: `${project.name} · lane ${slot + 1}`,
      branchName: laneBranchName(config.laneId),
      baseRef: project.baseRef ?? 'main',
    });
    if (!created.success) {
      this.setRuntime(config.laneId, { session: 'failed', error: created.error });
      return;
    }
    await this.startSession(config.laneId);
  }

  private async startSession(laneId: string): Promise<Result<void, LaneError>> {
    const initial = this.locate(laneId);
    if (!initial) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    this.setRuntime(laneId, { session: 'starting', error: null });
    try {
      const provisioned = await this.ports.tasks.provision(initial.config.taskId);
      if (!provisioned.success) return this.failStart(laneId, provisioned.error);
      this.worktrees.set(laneId, provisioned.data.path);
      await this.ports.brain
        ?.prepareLaunch(initial.config)
        .catch((error: unknown) => this.ports.onError('lanes: Brain launch prep failed', error));
      // Re-read: the lane may have moved or been removed while provisioning.
      const location = this.locate(laneId);
      if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
      const { config } = location;
      if (config.conversationReady) {
        await this.ports.conversations.launch({
          conversationId: config.conversationId,
          projectId: config.projectId,
          taskId: config.taskId,
        });
      } else {
        await this.ports.conversations.create({
          conversationId: config.conversationId,
          projectId: config.projectId,
          taskId: config.taskId,
          provider: config.provider,
          model: config.model,
          title: `Lane ${location.slot + 1}`,
        });
        config.conversationReady = true;
        this.persist();
      }
    } catch (error) {
      return this.failStart(laneId, messageOf(error));
    }
    this.setRuntime(laneId, { session: 'running', error: null });
    return ok(undefined);
  }

  private failStart(laneId: string, message: string): Result<void, LaneError> {
    this.setRuntime(laneId, { session: 'failed', error: message });
    return err(laneError('start-failed', message));
  }

  private async setAsleep(laneId: string, asleep: boolean): Promise<Result<void, LaneError>> {
    await this.initialize();
    const location = this.locate(laneId);
    if (!location) return err(laneError('lane-not-found', 'That lane no longer exists.'));
    location.config.asleep = asleep;
    this.commit();
    return ok(undefined);
  }

  private setRuntime(laneId: string, runtime: LaneRuntime): void {
    if (!this.locate(laneId)) return;
    this.runtime.set(laneId, runtime);
    this.emit({ type: 'lane-session', laneId, ...runtime });
    this.publish();
  }

  private findConfigByConversation(conversationId: string): LaneConfig | undefined {
    for (const tab of this.grid.tabs) {
      const lane = tab.slots.find((candidate) => candidate?.conversationId === conversationId);
      if (lane) return lane;
    }
    return undefined;
  }

  private locate(laneId: string): LaneLocation | undefined {
    for (const tab of this.grid.tabs) {
      const slot = tab.slots.findIndex((lane) => lane?.laneId === laneId);
      const config = tab.slots[slot];
      if (config) return { tab, slot: slot as LaneSlot, config };
    }
    return undefined;
  }

  /** Local transitions (starting/failed) win; otherwise the runtime's session feed does. */
  private sessionOf(config: LaneConfig): LaneSession {
    const local = this.runtime.get(config.laneId);
    if (local?.session === 'starting' || local?.session === 'failed') return local.session;
    const fed = this.snapshot.sessions.get(config.conversationId);
    if (fed !== undefined) return mapLaneSession(fed);
    return local?.session ?? 'stopped';
  }

  private track(work: Promise<unknown>): void {
    const tracked = work
      .then(() => undefined)
      .catch((error: unknown) => this.ports.onError('lanes: background work failed', error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private commit(): void {
    this.persist();
    this.publish();
  }

  private persist(): void {
    const snapshot = structuredClone(this.grid);
    this.saveChain = this.saveChain
      .then(() => this.ports.persistence.save(snapshot))
      .catch((error: unknown) => this.ports.onError('lanes: failed to save the lanes grid', error));
  }

  private publish(): void {
    const statuses: LaneStatusMap = {};
    const board: LaneBoard = {
      tabs: this.grid.tabs.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        slots: tab.slots.map((config, slot) => {
          if (!config) return null;
          const override = this.ports.brain?.override(config.laneId);
          const status = mapLaneStatus({
            asleep: config.asleep,
            agent: this.snapshot.agents.get(config.conversationId),
            job: override?.job,
          });
          statuses[config.laneId] = status;
          return {
            ...config,
            ...(override?.activeJobId ? { activeJobId: override.activeJobId } : {}),
            tabId: tab.tabId,
            slot: slot as LaneSlot,
            session: this.sessionOf(config),
            status,
            projectName: this.projectNames.get(config.projectId) ?? null,
            branch: laneBranchName(config.laneId),
            error: this.runtime.get(config.laneId)?.error ?? null,
          };
        }),
      })),
    };
    this.board.set(board);
    this.statuses.set(statuses);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.ports.onError('lanes: change listener failed', error);
      }
    }
  }
}

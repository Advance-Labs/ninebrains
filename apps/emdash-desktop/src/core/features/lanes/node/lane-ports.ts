import type { TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import type { Result } from '@emdash/shared';
import type { LaneConfig, LaneProvider, LanesGridConfig } from '../api';
import type { LaneJobOverride, TuiSessionStatus } from './lane-status';

/**
 * Narrow ports LaneService depends on. `createNinebrainsServices` builds them
 * from upstream services; tests substitute fakes.
 */

export type LaneProjectInfo = {
  projectId: string;
  name: string;
  /** `remote` for SSH projects, which v0.1 lanes do not support. */
  host: 'local' | 'remote';
  baseRef: string | null;
};

export interface LaneProjectsPort {
  get(projectId: string): Promise<LaneProjectInfo | null>;
}

export interface LaneTasksPort {
  /** Creates a Task whose workspace is a new worktree on a fresh branch. */
  createWorktreeTask(input: {
    taskId: string;
    projectId: string;
    name: string;
    branchName: string;
    baseRef: string;
  }): Promise<Result<void, string>>;
  /**
   * Provisions the Task explicitly: the renderer's activation coordinator only
   * activates the current task, so four live lanes need four explicit calls.
   */
  provision(taskId: string): Promise<Result<{ path: string }, string>>;
  deleteTask(
    projectId: string,
    taskId: string,
    options: { deleteWorktree: boolean }
  ): Promise<void>;
}

export interface LaneConversationsPort {
  /** Creates the PTY conversation and launches it. Always `autoApprove: false`. */
  create(input: {
    conversationId: string;
    projectId: string;
    taskId: string;
    provider: LaneProvider;
    model: string | null;
    title: string;
  }): Promise<void>;
  /** Starts or resumes an existing conversation's PTY. */
  launch(input: { conversationId: string; projectId: string; taskId: string }): Promise<void>;
  stop(conversationId: string): Promise<void>;
}

export interface LanePersistencePort {
  load(): Promise<LanesGridConfig | null>;
  save(config: LanesGridConfig): Promise<void>;
}

/** Hook detail beyond the status: the Brain's paste rule (SEC-15) reads it. */
export type LaneAgentDetail = { notificationType?: string; message?: string };

export type LaneAgentSnapshot = {
  agents: ReadonlyMap<string, TuiAgentStateStatus>;
  sessions: ReadonlyMap<string, TuiSessionStatus>;
  details?: ReadonlyMap<string, LaneAgentDetail>;
};

/** Hook-driven agent states and PTY sessions, keyed by conversation id. */
export interface LaneAgentFeedPort {
  subscribe(listener: (snapshot: LaneAgentSnapshot) => void): () => void;
}

export type LaneLaunchOverrides = {
  extraArgs: string[];
  providerVars: Record<string, string>;
};

/** What upstream is about to launch, so the Brain can guard and scope it. */
export type LaneUpstreamLaunch = {
  /** The user's provider `extraArgs`, which upstream puts before ours. */
  extraArgs: readonly string[];
  autoApprove: boolean;
  /** The Task's worktree: the launch cwd. */
  cwd: string;
};

/** Phase 2 (Brain) hooks. Optional, so Phase 1 fakes need none. */
export interface LaneBrainPort {
  /** Async warm-up before a session starts (pack servers, secrets). */
  prepareLaunch(lane: LaneConfig): Promise<void>;
  /** Per-launch `--mcp-config`/`--settings` flags and env; mints this launch's token. */
  resolveLaunch(lane: LaneConfig, upstream: LaneUpstreamLaunch): LaneLaunchOverrides | undefined;
  /** Revokes the lane's token and deletes its launch files (stop, relaunch, remove). */
  releaseLaunch(laneId: string): void;
  /** Brain Job state that overrides the light, and the lane's active job. */
  override(laneId: string): { job?: LaneJobOverride; activeJobId?: string } | undefined;
}

export type LaneServicePorts = {
  projects: LaneProjectsPort;
  tasks: LaneTasksPort;
  conversations: LaneConversationsPort;
  persistence: LanePersistencePort;
  agentFeed: LaneAgentFeedPort;
  brain?: LaneBrainPort;
  /**
   * T47: the live `ninebrains.routing.profilesEnabled` setting, called on every
   * `createLane`/`setLaneRouting` — not cached at construction, so a toggle in Settings → Models
   * takes effect immediately. Falls back to `MODEL_PROFILES_ENABLED` (always true) when omitted,
   * which is what tests that don't care about routing use.
   */
  modelProfilesEnabled?: () => boolean | Promise<boolean>;
  newId(): string;
  onError(context: string, error: unknown): void;
};

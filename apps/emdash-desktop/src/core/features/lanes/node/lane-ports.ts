import type { TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import type { Result } from '@emdash/shared';
import type { LaneProvider, LanesGridConfig } from '../api';
import type { TuiSessionStatus } from './lane-status';

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
  deleteTask(projectId: string, taskId: string, options: { deleteWorktree: boolean }): Promise<void>;
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

export type LaneAgentSnapshot = {
  agents: ReadonlyMap<string, TuiAgentStateStatus>;
  sessions: ReadonlyMap<string, TuiSessionStatus>;
};

/** Hook-driven agent states and PTY sessions, keyed by conversation id. */
export interface LaneAgentFeedPort {
  subscribe(listener: (snapshot: LaneAgentSnapshot) => void): () => void;
}

export type LaneLaunchOverrides = {
  extraArgs: string[];
  providerVars: Record<string, string>;
};

export type LaneServicePorts = {
  projects: LaneProjectsPort;
  tasks: LaneTasksPort;
  conversations: LaneConversationsPort;
  persistence: LanePersistencePort;
  agentFeed: LaneAgentFeedPort;
  newId(): string;
  onError(context: string, error: unknown): void;
};

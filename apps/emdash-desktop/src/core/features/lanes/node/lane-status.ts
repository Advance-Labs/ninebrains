import type { TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import type { LaneSession, LaneStatus } from '../api';

/** TUI runtime session status (`tuiAgents.sessions`). */
export type TuiSessionStatus = 'starting' | 'running' | 'exited';

/** Brain Job states that override the hook-derived light (Phase 2). */
export type LaneJobOverride = 'verifying' | 'blocked';

export type LaneStatusInput = {
  asleep: boolean;
  agent?: TuiAgentStateStatus;
  job?: LaneJobOverride;
};

/**
 * Status comes only from hooks, never from terminal output
 * (agents/integrations/providers.md). Sleep wins, then Brain Job state, then hooks.
 */
export function mapLaneStatus({ asleep, agent, job }: LaneStatusInput): LaneStatus {
  if (asleep) return 'asleep';
  if (job) return job;
  switch (agent) {
    case 'working':
      return 'running';
    case 'awaiting-input':
      return 'waiting';
    case 'error':
      return 'blocked';
    case 'idle':
    case 'completed':
    case undefined:
      return 'idle';
  }
}

/** Maps the runtime session to the lane session; `undefined` means no PTY. */
export function mapLaneSession(session: TuiSessionStatus | undefined): LaneSession {
  switch (session) {
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'exited':
    case undefined:
      return 'stopped';
  }
}

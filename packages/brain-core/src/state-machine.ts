import { IllegalTransitionError } from './errors';
import type { TaskId, TaskState } from './types';

/** Failed gate runs allowed before a task is blocked. */
export const MAX_ATTEMPTS = 3;

/**
 * Every legal edge of the task state machine. Anything not listed throws.
 *
 *   proposed -> ready -> claimed -> running -> verifying -> done
 *                  ^                  ^           |
 *                  |                  +-----------+  gate failed (attempts += 1)
 *   blocked / failed --requeue--> ready | proposed
 *
 * - `proposed` means "exists but not ready": it has an unfinished dependency
 *   or has not been promoted yet. `ready -> proposed` happens when a new
 *   unmet dependency is linked in.
 * - `claimed -> ready` releases a claim (lane went away before starting).
 * - Any live state can go to `blocked` (lane gave up, attempt cap, Brain
 *   decision). `failed` is for runs that crashed or were abandoned.
 * - `done` is terminal. Removal from a plan archives, it does not transition.
 */
const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  proposed: ['ready', 'blocked', 'failed'],
  ready: ['proposed', 'claimed', 'blocked', 'failed'],
  claimed: ['running', 'ready', 'blocked', 'failed'],
  running: ['verifying', 'blocked', 'failed'],
  verifying: ['done', 'running', 'blocked', 'failed'],
  done: [],
  blocked: ['ready', 'proposed'],
  failed: ['ready', 'proposed'],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: TaskState): readonly TaskState[] {
  return TRANSITIONS[from];
}

export function assertTransition(taskId: TaskId, from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(taskId, from, to);
  }
}

/** States in which a lane holds the task. */
export const HELD_STATES: readonly TaskState[] = ['claimed', 'running', 'verifying'];

export function isTerminal(state: TaskState): boolean {
  return TRANSITIONS[state].length === 0;
}

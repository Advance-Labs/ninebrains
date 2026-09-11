import { IllegalTransitionError } from './errors';
import type { JobId, JobState } from './types';

/** Failed gate runs allowed before a job is blocked. */
export const MAX_ATTEMPTS = 3;

/**
 * Every legal edge of the job state machine. Anything not listed throws.
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
const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  proposed: ['ready', 'blocked', 'failed'],
  ready: ['proposed', 'claimed', 'blocked', 'failed'],
  claimed: ['running', 'ready', 'blocked', 'failed'],
  running: ['verifying', 'blocked', 'failed'],
  verifying: ['done', 'running', 'blocked', 'failed'],
  done: [],
  blocked: ['ready', 'proposed'],
  failed: ['ready', 'proposed'],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: JobState): readonly JobState[] {
  return TRANSITIONS[from];
}

export function assertTransition(jobId: JobId, from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(jobId, from, to);
  }
}

/** States in which a lane holds the job. */
export const HELD_STATES: readonly JobState[] = ['claimed', 'running', 'verifying'];

export function isTerminal(state: JobState): boolean {
  return TRANSITIONS[state].length === 0;
}

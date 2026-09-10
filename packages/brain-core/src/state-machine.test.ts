import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, isBrainError } from './errors';
import { allowedTransitions, assertTransition, canTransition, isTerminal, MAX_ATTEMPTS } from './state-machine';
import { JOB_STATES, type JobState } from './types';

const LEGAL: Record<JobState, JobState[]> = {
  proposed: ['ready', 'blocked', 'failed'],
  ready: ['proposed', 'claimed', 'blocked', 'failed'],
  claimed: ['running', 'ready', 'blocked', 'failed'],
  running: ['verifying', 'blocked', 'failed'],
  verifying: ['done', 'running', 'blocked', 'failed'],
  done: [],
  blocked: ['ready', 'proposed'],
  failed: ['ready', 'proposed'],
};

describe('job state machine', () => {
  it('allows exactly the documented transitions (all 64 pairs)', () => {
    for (const from of JOB_STATES) {
      for (const to of JOB_STATES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(LEGAL[from].includes(to));
      }
    }
  });

  it('throws a typed error for an illegal transition', () => {
    let caught: unknown;
    try {
      assertTransition('t1', 'ready', 'done');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IllegalTransitionError);
    expect(isBrainError(caught)).toBe(true);
    const error = caught as IllegalTransitionError;
    expect(error.code).toBe('ILLEGAL_TRANSITION');
    expect([error.jobId, error.from, error.to]).toEqual(['t1', 'ready', 'done']);
    expect(error.name).toBe('IllegalTransitionError');
  });

  it('does not throw for legal transitions', () => {
    expect(() => assertTransition('t1', 'verifying', 'running')).not.toThrow();
  });

  it('never allows self-transitions or skipping verification', () => {
    for (const state of JOB_STATES) expect(canTransition(state, state)).toBe(false);
    expect(canTransition('running', 'done')).toBe(false);
    expect(canTransition('claimed', 'verifying')).toBe(false);
  });

  it('treats done as the only terminal state', () => {
    expect(JOB_STATES.filter(isTerminal)).toEqual(['done']);
    expect(allowedTransitions('done')).toEqual([]);
  });

  it('caps attempts at 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

import { InvalidInputError } from '../errors';
import type { BrainEmitter, BrainEvent } from '../events';
import { LIMITS, utf8Bytes } from '../limits';
import { assertTransition } from '../state-machine';
import type { BrainStore } from '../store/store';
import type { Job, JobState } from '../types';

export interface BrainContext {
  store: BrainStore;
  emitter: BrainEmitter;
  now: () => number;
  newId: () => string;
}

/** Events raised inside one transaction; persisted with it, emitted after commit. */
export class Tx {
  readonly events: BrainEvent[] = [];

  raise(event: BrainEvent): void {
    this.events.push(event);
  }
}

/**
 * Runs `fn` in one store transaction. Its events go to the durable event log
 * in the same transaction (so other processes see them exactly when the data
 * lands) and to local listeners only after commit (so a rolled-back change
 * never notifies anyone). Operation helpers take the `Tx`; they never call
 * `mutate` themselves, which keeps emission strictly post-commit.
 */
export function mutate<T>(ctx: BrainContext, fn: (tx: Tx) => T): T {
  const tx = new Tx();
  const result = ctx.store.transaction(() => {
    const value = fn(tx);
    const at = ctx.now();
    for (const event of tx.events) ctx.store.appendEvent(event, at);
    return value;
  });
  for (const event of tx.events) ctx.emitter.emit(event.type, event.payload as never);
  return result;
}

/** Moves a job along a legal edge of the state machine and records the change. */
export function transition(
  ctx: BrainContext,
  tx: Tx,
  job: Job,
  to: JobState,
  patch: Partial<Omit<Job, 'id' | 'state'>> = {}
): Job {
  assertTransition(job.id, job.state, to);
  const next: Job = { ...job, ...patch, state: to, updatedAt: ctx.now() };
  ctx.store.updateJob(next);
  tx.raise({ type: 'jobChanged', payload: { job: next, previousState: job.state } });
  return next;
}

/** Writes a non-state change (content, archival) and records it. */
export function touch(ctx: BrainContext, tx: Tx, job: Job, patch: Partial<Omit<Job, 'id' | 'state'>>): Job {
  const next: Job = { ...job, ...patch, updatedAt: ctx.now() };
  ctx.store.updateJob(next);
  tx.raise({ type: 'jobChanged', payload: { job: next, previousState: job.state } });
  return next;
}

export function checkText(label: string, value: string, maxBytes: number, required = true): void {
  if (required && value.trim().length === 0) throw new InvalidInputError(`${label} must not be empty`);
  if (utf8Bytes(value) > maxBytes) throw new InvalidInputError(`${label} exceeds ${maxBytes} bytes`);
}

export function checkTitle(title: string): void {
  if (title.trim().length === 0) throw new InvalidInputError('title must not be empty');
  if (title.length > LIMITS.titleChars) throw new InvalidInputError(`title exceeds ${LIMITS.titleChars} characters`);
}

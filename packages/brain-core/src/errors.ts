import type { JobId, JobState } from './types';

export type BrainErrorCode = 'ILLEGAL_TRANSITION' | 'NOT_FOUND' | 'FORBIDDEN' | 'CYCLE' | 'INVALID';

/** Base class for every error the Brain throws on purpose. */
export class BrainError extends Error {
  readonly code: BrainErrorCode;

  constructor(code: BrainErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class IllegalTransitionError extends BrainError {
  readonly jobId: JobId;
  readonly from: JobState;
  readonly to: JobState;

  constructor(jobId: JobId, from: JobState, to: JobState, detail?: string) {
    super(
      'ILLEGAL_TRANSITION',
      `job ${jobId}: cannot move ${from} -> ${to}${detail ? ` (${detail})` : ''}`
    );
    this.jobId = jobId;
    this.from = from;
    this.to = to;
  }
}

export class NotFoundError extends BrainError {
  constructor(kind: string, id: string) {
    super('NOT_FOUND', `${kind} ${id} not found`);
  }
}

export class ForbiddenError extends BrainError {
  constructor(message: string) {
    super('FORBIDDEN', message);
  }
}

export class CycleError extends BrainError {
  /** The cycle, first node repeated at the end: `[a, b, c, a]`. */
  readonly path: string[];

  constructor(path: string[]) {
    super('CYCLE', `dependency cycle: ${path.join(' -> ')}`);
    this.path = path;
  }
}

export class InvalidInputError extends BrainError {
  constructor(message: string) {
    super('INVALID', message);
  }
}

export function isBrainError(value: unknown): value is BrainError {
  return value instanceof BrainError;
}

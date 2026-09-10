import type { TaskId, TaskState } from './types';

export type BrainErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CYCLE'
  | 'INVALID';

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
  readonly taskId: TaskId;
  readonly from: TaskState;
  readonly to: TaskState;

  constructor(taskId: TaskId, from: TaskState, to: TaskState, detail?: string) {
    super(
      'ILLEGAL_TRANSITION',
      `task ${taskId}: cannot move ${from} -> ${to}${detail ? ` (${detail})` : ''}`
    );
    this.taskId = taskId;
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

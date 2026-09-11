import { InvalidInputError } from './errors';

/**
 * SEC-14: every ID (laneId, jobId, brainId, projectId, planId, planNodeId)
 * is a safe path segment. No `.`, `..`, `:` (NTFS alternate data streams) or
 * separators, and at most 64 characters.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function assertId(label: string, value: unknown): string {
  if (!isId(value)) {
    throw new InvalidInputError(`${label} must be 1-64 characters of letters, digits, _ or -`);
  }
  return value;
}

/**
 * The only way an ID should become a path segment: re-validates at the point
 * of use, so a value that bypassed an earlier check still cannot traverse.
 */
export function idPathSegment(label: string, value: unknown): string {
  return assertId(label, value);
}

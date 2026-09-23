import { rm } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { GitExecFactory } from '#services/exec/node/git-exec';
import type { CleanArtifactsError } from '../api/errors';
import type { CleanArtifactsResult } from '../api/schemas';
import { isSafePattern, resolvePatternMatches } from './copy-artifacts';
import { listIgnoredArtifactRoots } from './measure-usage';

/** Everything but the record-resolution variants, which the runtime handles itself. */
export type CleanWorkspaceArtifactsError = Extract<
  CleanArtifactsError,
  { type: 'git-command-failed' | 'filesystem-error' | 'unsafe-artifact-path' }
>;

export type CleanWorkspaceArtifactsOptions = {
  /** Absolute native path, as stored on the registry record. */
  workspacePath: string;
  /** The record's own preserve selection: matches survive the clean. */
  preservePatterns: readonly string[];
  createGitExec?: GitExecFactory;
};

/**
 * Removes the same git-ignored roots `measureUsage` reports as reclaimable
 * (`git clean -ndX`), except roots that are, contain, or sit inside a
 * `preservePatterns` match: those are the files (`.env` and friends) copied in on
 * purpose at creation, and nothing recreates them after a clean. Listing and
 * containment reuse the measurement path, so "reclaimable" and "removed" agree.
 */
export async function cleanWorkspaceArtifacts(
  options: CleanWorkspaceArtifactsOptions
): Promise<Result<CleanArtifactsResult, CleanWorkspaceArtifactsError>> {
  const roots = await listIgnoredArtifactRoots(options.workspacePath, options);
  if (!roots.success) return roots;

  let preserved: string[];
  try {
    const patterns = options.preservePatterns.filter(isSafePattern);
    preserved =
      patterns.length === 0 ? [] : await resolvePatternMatches(options.workspacePath, patterns);
  } catch (error) {
    return err({
      type: 'filesystem-error',
      message: `Could not resolve preserve patterns: ${errorMessage(error)}`,
    });
  }

  const result: CleanArtifactsResult = { removed: [], kept: [], errors: [] };
  for (const root of roots.data) {
    if (preserved.some((match) => pathsOverlap(root, match))) {
      result.kept.push(root);
      continue;
    }
    try {
      await rm(path.join(options.workspacePath, root), { recursive: true, force: true });
      result.removed.push(root);
    } catch (error) {
      result.errors.push({ path: root, message: errorMessage(error) });
    }
  }
  return ok(result);
}

/** True when one workspace-relative path equals, contains, or sits inside the other. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

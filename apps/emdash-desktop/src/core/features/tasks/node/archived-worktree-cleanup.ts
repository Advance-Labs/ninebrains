import type { Logger } from '@emdash/shared/logger';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import type { ArchivedTaskCleanupResult } from '@core/primitives/tasks/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArchivedWorktreeCandidate = {
  projectId: string;
  /** Every live task on the worktree; all of them are past the retention window. */
  taskIds: string[];
  workspace: WorkspaceRow;
};

export type ArchivedTaskSweepDependencies = {
  db: AppDb;
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  /** Deletes the task with its worktree, branch and conversations. */
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  now?: () => number;
  logger?: Pick<Logger, 'info' | 'warn'>;
};

export type ArchivedTaskSweepOptions = {
  retentionDays: number;
  /** Count what would be removed without deleting anything. */
  dryRun?: boolean;
};

/**
 * Ninebrains: deletes tasks archived longer than the retention window, together with
 * their worktree and branch, through the ordinary Delete Task path. Archived worktrees
 * otherwise accumulate as live workspace rows that every registry delivery re-applies.
 * A worktree that is not provably clean is skipped (see isArchivedWorktreeSafeToRemove),
 * and Projects that are not attached are skipped until a later run, so a task is never
 * deleted while its worktree removal cannot reach the host.
 */
export async function sweepArchivedTasks(
  deps: ArchivedTaskSweepDependencies,
  options: ArchivedTaskSweepOptions
): Promise<ArchivedTaskCleanupResult> {
  const result: ArchivedTaskCleanupResult = { removed: 0, skipped: 0, failed: 0 };
  const cutoffMs = (deps.now ?? Date.now)() - options.retentionDays * DAY_MS;
  for (const candidate of selectArchivedWorktreeCandidates(deps.db, cutoffMs)) {
    if (
      !isArchivedWorktreeSafeToRemove(candidate.workspace) ||
      !deps.projects.requireAttached(candidate.projectId).success
    ) {
      result.skipped += 1;
      continue;
    }
    if (options.dryRun) {
      result.removed += 1;
      continue;
    }
    try {
      // Sequential: deleteTask only removes the worktree once no other live task holds it.
      for (const taskId of candidate.taskIds) await deps.deleteTask(candidate.projectId, taskId);
      result.removed += 1;
      deps.logger?.info('archived task cleanup: removed task and worktree', {
        workspaceId: candidate.workspace.id,
        path: candidate.workspace.path,
      });
    } catch (error) {
      result.failed += 1;
      deps.logger?.warn('archived task cleanup: removal failed', {
        workspaceId: candidate.workspace.id,
        error: String(error),
      });
    }
  }
  return result;
}

/**
 * Worktrees whose every live task has been archived since before `cutoffMs`: provenance
 * `new-worktree` rows (Emdash created them) that are present, registered, and not already
 * queued for deletion. Adopted worktrees are never touched; Emdash did not create them.
 */
export function selectArchivedWorktreeCandidates(
  db: AppDb,
  cutoffMs: number
): ArchivedWorktreeCandidate[] {
  const liveTasks = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      workspaceId: tasks.workspaceId,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNotNull(tasks.workspaceId)))
    .all();

  // A workspace shared with any unarchived (or recently archived) task stays.
  const byWorkspace = new Map<string, { projectId: string; taskIds: string[]; expired: boolean }>();
  for (const task of liveTasks) {
    if (!task.workspaceId) continue;
    const archivedMs = parseSqliteTimestamp(task.archivedAt);
    const expired = archivedMs !== null && archivedMs <= cutoffMs;
    const current = byWorkspace.get(task.workspaceId);
    byWorkspace.set(task.workspaceId, {
      projectId: current?.projectId ?? task.projectId,
      taskIds: [...(current?.taskIds ?? []), task.id],
      expired: (current?.expired ?? true) && expired,
    });
  }

  const registry = createWorkspaceRegistry(db);
  const candidates: ArchivedWorktreeCandidate[] = [];
  for (const [workspaceId, entry] of byWorkspace) {
    if (!entry.expired) continue;
    const workspace = registry.getLive(workspaceId);
    if (
      !workspace?.path ||
      workspace.kind !== 'worktree' ||
      workspace.config?.workspace.kind !== 'new-worktree' ||
      workspace.observedStatus !== 'present' ||
      workspace.deletionTombstone !== null
    ) {
      continue;
    }
    candidates.push({ projectId: entry.projectId, taskIds: entry.taskIds, workspace });
  }
  return candidates;
}

/**
 * The last guard before an unattended delete: no user is asked, so decide from the host's
 * latest git observation on the mirror row.
 */
export function isArchivedWorktreeSafeToRemove(workspace: WorkspaceRow): boolean {
  const git = workspace.observedGit;
  // Never observed: nothing proves the tree clean, so a later run decides.
  if (!git) return false;
  // Uncommitted or untracked work is never removed automatically.
  if (git.dirty || (git.diffStats !== null && git.diffStats.added + git.diffStats.deleted > 0)) {
    return false;
  }
  // Detached HEAD: its commits are on no branch at all.
  if (git.branch === null) return false;
  // `git worktree lock` is an explicit request to keep the worktree.
  return !git.locked;
}

/** SQLite `CURRENT_TIMESTAMP` ('YYYY-MM-DD HH:MM:SS', UTC) or ISO-8601; null if unset. */
function parseSqliteTimestamp(value: string | null): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

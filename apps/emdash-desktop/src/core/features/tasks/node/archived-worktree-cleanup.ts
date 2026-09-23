import type { Logger } from '@emdash/shared/logger';
import { and, isNotNull, isNull } from 'drizzle-orm';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

/** A task archived longer than this gives up its worktree; the branch stays. */
export const ARCHIVED_WORKTREE_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArchivedWorktreeCandidate = {
  projectId: string;
  workspace: WorkspaceRow;
};

export type ArchivedWorktreeSweepDependencies = {
  db: AppDb;
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  /** Read per run so toggling the setting takes effect without a restart. */
  isEnabled: () => Promise<boolean>;
  now?: () => number;
  logger?: Pick<Logger, 'info' | 'warn'>;
};

export type ArchivedWorktreeSweepResult = {
  removed: number;
  skipped: number;
  failed: number;
};

/**
 * Removes the worktrees of tasks archived over the retention window, through the host
 * `deleteWorktree` verb with `deleteBranch: false`. The desktop mirror row is left in
 * place on purpose: it carries the creation spec, so the next registry delivery marks
 * it missing and Restore replays the creation onto the kept branch (the same path
 * `reprovisionWorkspace` uses). Projects that are not attached are skipped until a
 * later run; nothing is queued for an unreachable host.
 */
export async function sweepArchivedWorktrees(
  deps: ArchivedWorktreeSweepDependencies
): Promise<ArchivedWorktreeSweepResult> {
  const result: ArchivedWorktreeSweepResult = { removed: 0, skipped: 0, failed: 0 };
  if (!(await deps.isEnabled())) return result;

  const cutoffMs = (deps.now ?? Date.now)() - ARCHIVED_WORKTREE_RETENTION_DAYS * DAY_MS;
  for (const candidate of selectArchivedWorktreeCandidates(deps.db, cutoffMs)) {
    if (!isArchivedWorktreeSafeToRemove(candidate.workspace)) {
      result.skipped += 1;
      continue;
    }
    const attached = deps.projects.requireAttached(candidate.projectId);
    if (!attached.success) {
      result.skipped += 1;
      continue;
    }
    const removed = await attached.data.workspaceRegistry
      .deleteWorktree({ workspaceId: candidate.workspace.id, deleteBranch: false })
      .catch((error: unknown) => ({
        success: false as const,
        error: { type: 'remove-failed', message: String(error) },
      }));
    if (!removed.success) {
      result.failed += 1;
      deps.logger?.warn('archived worktree cleanup: removal failed', {
        workspaceId: candidate.workspace.id,
        error: removed.error.type,
      });
      continue;
    }
    result.removed += 1;
    deps.logger?.info('archived worktree cleanup: removed worktree', {
      workspaceId: candidate.workspace.id,
      path: candidate.workspace.path,
    });
  }
  if (result.removed > 0) appDbPokes.workspaces.poke({});
  return result;
}

/**
 * Worktrees whose every live task has been archived since before `cutoffMs`, and
 * that Restore can recreate: provenance `new-worktree` rows (Emdash created them and
 * holds the creation spec) that are present, registered, and not already queued for
 * deletion. Adopted worktrees are never touched; Emdash did not create them.
 */
export function selectArchivedWorktreeCandidates(
  db: AppDb,
  cutoffMs: number
): ArchivedWorktreeCandidate[] {
  const liveTasks = db
    .select({
      projectId: tasks.projectId,
      workspaceId: tasks.workspaceId,
      archivedAt: tasks.archivedAt,
    })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNotNull(tasks.workspaceId)))
    .all();

  // A workspace shared with any unarchived (or recently archived) task stays.
  const byWorkspace = new Map<string, { projectId: string; expired: boolean }>();
  for (const task of liveTasks) {
    if (!task.workspaceId) continue;
    const archivedMs = parseSqliteTimestamp(task.archivedAt);
    const expired = archivedMs !== null && archivedMs <= cutoffMs;
    const current = byWorkspace.get(task.workspaceId);
    byWorkspace.set(task.workspaceId, {
      projectId: current?.projectId ?? task.projectId,
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
    candidates.push({ projectId: entry.projectId, workspace });
  }
  return candidates;
}

/**
 * The last guard before a force-remove: the host `deleteWorktree` verb refuses nothing
 * by design (informed confirmation is the client's job), and here no user is asked.
 * Decides from the host's latest git observation on the mirror row.
 */
export function isArchivedWorktreeSafeToRemove(workspace: WorkspaceRow): boolean {
  const git = workspace.observedGit;
  // Never observed: nothing proves the tree clean, so a later run decides.
  if (!git) return false;
  // Uncommitted or untracked work is the one thing the kept branch cannot bring back.
  if (git.dirty || (git.diffStats !== null && git.diffStats.added + git.diffStats.deleted > 0)) {
    return false;
  }
  // Detached HEAD: its commits are on no branch, so Restore could not recover them.
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

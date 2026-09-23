import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import type { WorkspaceObservedGit } from '@core/primitives/workspaces/api/workspace-registry-observations';
import { tasks } from '@core/services/app-db/node/schema';
import {
  ARCHIVED_WORKTREE_RETENTION_DAYS,
  selectArchivedWorktreeCandidates,
  sweepArchivedWorktrees,
} from './archived-worktree-cleanup';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const CUTOFF = NOW - ARCHIVED_WORKTREE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LONG_AGO = '2026-07-01 09:00:00';
const RECENTLY = '2026-09-20 09:00:00';

const CLEAN_GIT: WorkspaceObservedGit = {
  version: '2',
  branch: 'feature',
  dirty: false,
  diffStats: null,
  ahead: 2,
  behind: 0,
  locked: false,
  prunable: false,
  headOid: 'abc123',
  upstream: null,
  prBreadcrumb: null,
};

describe('archived worktree cleanup', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, created_at, updated_at)
         VALUES ('project-1', 'Project', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
  });

  afterEach(() => {
    fixture.close();
  });

  function seedWorktree(
    id: string,
    options: {
      adopted?: boolean;
      observedStatus?: 'present' | 'missing';
      observedGit?: WorkspaceObservedGit | null;
    } = {}
  ): void {
    createWorkspaceRegistry(fixture.db).recordCreationIntent({
      id,
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: `/repo/.worktrees/${id}`,
      config: options.adopted
        ? null
        : {
            version: '2',
            git: {
              kind: 'create-branch',
              branchName: `branch-${id}`,
              fromBranch: { type: 'local', branch: 'main' },
            },
            workspace: { kind: 'new-worktree' },
          },
    });
    fixture.db
      .update(workspaces)
      .set({
        observedStatus: options.observedStatus ?? 'present',
        observedGit: options.observedGit === undefined ? CLEAN_GIT : options.observedGit,
      })
      .where(eq(workspaces.id, id))
      .run();
  }

  async function seedTask(id: string, workspaceId: string, archivedAt: string | null) {
    await fixture.db.insert(tasks).values({
      id,
      projectId: 'project-1',
      name: id,
      status: 'in_progress',
      workspaceId,
      archivedAt,
    });
  }

  const selectedIds = () =>
    selectArchivedWorktreeCandidates(fixture.db, CUTOFF).map((c) => c.workspace.id);

  it('selects worktrees whose task was archived before the retention window', async () => {
    seedWorktree('ws-old');
    seedWorktree('ws-recent');
    seedWorktree('ws-active');
    await seedTask('task-old', 'ws-old', LONG_AGO);
    await seedTask('task-recent', 'ws-recent', RECENTLY);
    await seedTask('task-active', 'ws-active', null);

    expect(selectedIds()).toEqual(['ws-old']);
  });

  it('accepts ISO-8601 archive stamps as well as SQLite CURRENT_TIMESTAMP', async () => {
    seedWorktree('ws-iso');
    await seedTask('task-iso', 'ws-iso', '2026-07-01T09:00:00.000Z');

    expect(selectedIds()).toEqual(['ws-iso']);
  });

  it('keeps a worktree shared with any task that is not past the window', async () => {
    seedWorktree('ws-shared');
    await seedTask('task-a', 'ws-shared', LONG_AGO);
    await seedTask('task-b', 'ws-shared', null);

    expect(selectedIds()).toEqual([]);
  });

  it('never selects adopted or already missing worktrees', async () => {
    seedWorktree('ws-adopted', { adopted: true });
    seedWorktree('ws-missing', { observedStatus: 'missing' });
    await seedTask('task-adopted', 'ws-adopted', LONG_AGO);
    await seedTask('task-missing', 'ws-missing', LONG_AGO);

    expect(selectedIds()).toEqual([]);
  });

  function attachedProjects() {
    const deleteWorktree = vi.fn(
      async (_input: { workspaceId: string; deleteBranch: boolean }) => ({
        success: true as const,
        data: undefined,
      })
    );
    return {
      deleteWorktree,
      projects: {
        requireAttached: () => ({
          success: true as const,
          data: { workspaceRegistry: { deleteWorktree } } as never,
        }),
      },
    };
  }

  it('removes clean expired worktrees, keeping the branch and the mirror row', async () => {
    seedWorktree('ws-old');
    await seedTask('task-old', 'ws-old', LONG_AGO);
    const { deleteWorktree, projects } = attachedProjects();

    const result = await sweepArchivedWorktrees({
      db: fixture.db,
      projects,
      isEnabled: async () => true,
      now: () => NOW,
    });

    expect(result).toEqual({ removed: 1, skipped: 0, failed: 0 });
    expect(deleteWorktree).toHaveBeenCalledWith({ workspaceId: 'ws-old', deleteBranch: false });
    // Restore replays the creation from this row, so the sweep must not untrack it.
    expect(createWorkspaceRegistry(fixture.db).getLive('ws-old')).toBeDefined();
  });

  it.each([
    ['never observed', null],
    ['dirty', { ...CLEAN_GIT, dirty: true }],
    ['carrying a diff', { ...CLEAN_GIT, diffStats: { added: 3, deleted: 0 } }],
    ['on a detached HEAD', { ...CLEAN_GIT, branch: null }],
    ['locked', { ...CLEAN_GIT, locked: true }],
  ])('skips a worktree that is %s', async (_label, observedGit) => {
    seedWorktree('ws-old', { observedGit });
    await seedTask('task-old', 'ws-old', LONG_AGO);
    const { deleteWorktree, projects } = attachedProjects();

    const result = await sweepArchivedWorktrees({
      db: fixture.db,
      projects,
      isEnabled: async () => true,
      now: () => NOW,
    });

    expect(result).toEqual({ removed: 0, skipped: 1, failed: 0 });
    expect(deleteWorktree).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off', async () => {
    seedWorktree('ws-old');
    await seedTask('task-old', 'ws-old', LONG_AGO);
    const { deleteWorktree, projects } = attachedProjects();

    const result = await sweepArchivedWorktrees({
      db: fixture.db,
      projects,
      isEnabled: async () => false,
      now: () => NOW,
    });

    expect(result).toEqual({ removed: 0, skipped: 0, failed: 0 });
    expect(deleteWorktree).not.toHaveBeenCalled();
  });

  it('skips detached Projects and counts host failures without throwing', async () => {
    seedWorktree('ws-a');
    seedWorktree('ws-b');
    await seedTask('task-a', 'ws-a', LONG_AGO);
    await seedTask('task-b', 'ws-b', LONG_AGO);
    const deleteWorktree = vi.fn(async () => {
      throw new Error('host went away');
    });
    let calls = 0;
    const projects = {
      requireAttached: () =>
        calls++ === 0
          ? ({
              success: false as const,
              error: {
                type: 'attachment-unavailable' as const,
                host: {} as never,
                phase: 'waiting' as const,
              },
            } as never)
          : ({ success: true as const, data: { workspaceRegistry: { deleteWorktree } } } as never),
    };

    const result = await sweepArchivedWorktrees({
      db: fixture.db,
      projects,
      isEnabled: async () => true,
      now: () => NOW,
    });

    expect(result).toEqual({ removed: 0, skipped: 1, failed: 1 });
  });
});

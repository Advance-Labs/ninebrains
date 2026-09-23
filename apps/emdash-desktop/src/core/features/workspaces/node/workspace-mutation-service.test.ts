import { describe, expect, it, vi } from 'vitest';
import { WorkspaceMutationService } from './workspace-mutation-service';

const unavailableProjects = {
  requireAttached: () => ({
    success: false as const,
    error: {
      type: 'attachment-unavailable' as const,
      host: {} as never,
      phase: 'waiting' as const,
    },
  }),
};

describe('WorkspaceMutationService', () => {
  it('refuses an artifact clean when Project attachment is unavailable', async () => {
    const runtimeClient = vi.fn();
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: { client: runtimeClient } as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'project-unavailable',
        message: 'This action requires live Project access.',
      },
    });
    expect(runtimeClient).not.toHaveBeenCalled();
  });

  it('summarizes the host artifact clean', async () => {
    const cleanArtifacts = vi.fn(async () => ({
      success: true as const,
      data: {
        removed: ['node_modules', 'dist'],
        kept: ['.env'],
        errors: [{ path: 'build', message: 'EACCES' }],
      },
    }));
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: {
        requireAttached: () => ({
          success: true as const,
          data: { workspaceRegistry: { cleanArtifacts } } as never,
        }),
      },
      runtimes: {} as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({ success: true, data: { removed: 2, kept: ['.env'], failed: 1 } });
    expect(cleanArtifacts).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
  });

  it('describes host refusals of an artifact clean', async () => {
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: {
        requireAttached: () => ({
          success: true as const,
          data: {
            workspaceRegistry: {
              cleanArtifacts: async () => ({
                success: false as const,
                error: { type: 'not-a-worktree' as const, workspaceId: 'workspace-1' },
              }),
            },
          } as never,
        }),
      },
      runtimes: {} as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'not-a-worktree',
        message: 'Only worktrees can have their artifacts cleaned.',
      },
    });
  });

  it('reports a missing Project when no live Task owns the workspace', async () => {
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: {} as never,
      projectIdForWorkspace: vi.fn(async () => undefined),
    });

    await expect(service.delete({ workspaceId: 'workspace-1' })).resolves.toEqual({
      success: false,
      error: {
        type: 'project-missing',
        message: 'The Project for this workspace was not found.',
      },
    });
  });

  it('checks the owning Project attachment before deleting', async () => {
    const runtimeClient = vi.fn();
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: { client: runtimeClient } as never,
      projectIdForWorkspace: vi.fn(async () => 'project-1'),
    });

    await expect(service.delete({ workspaceId: 'workspace-1' })).resolves.toEqual({
      success: false,
      error: {
        type: 'project-unavailable',
        message: 'This action requires live Project access.',
      },
    });
    expect(runtimeClient).not.toHaveBeenCalled();
  });
});

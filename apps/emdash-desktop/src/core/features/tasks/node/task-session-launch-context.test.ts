import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveSessionTmux,
  TaskSessionLaunchContextResolver,
} from '../api/node/task-session-launch-context';

function buildRuntimeClient(options: {
  getProjectConfig?: () => Promise<unknown>;
  resolveTmuxDependency?: () => Promise<unknown>;
}) {
  const getProjectConfig =
    options.getProjectConfig ??
    (async () =>
      ok({
        resolved: {
          shellSetup: { value: undefined, from: 'default' as const },
          env: { value: {}, from: 'default' as const },
        },
      }));
  const resolveTmuxDependency =
    options.resolveTmuxDependency ?? (async () => ok({ id: 'tmux', path: '/usr/bin/tmux' }));
  return {
    workspaceRegistry: { getProjectConfig },
    hostDependencies: { resolver: { resolve: vi.fn(resolveTmuxDependency) } },
  };
}

function buildResolver(options: {
  host: { type: 'local' | 'remote'; id: string };
  tmuxRequested: boolean;
  resolveTmuxDependency?: () => Promise<unknown>;
  appDefaultTmuxHistoryLimit?: number;
}) {
  const identity = {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    host: options.host,
    path: '/repo/worktree',
  };
  const settings = {
    resolveTmux: vi.fn(async () => ({
      value: options.tmuxRequested,
      provenance: { kind: 'set' as const },
    })),
    getStoredGitSettings: vi.fn(async () => ({
      defaultBranch: { remote: null, branch: 'main' },
    })),
    getPlacementContext: vi.fn(async () => ({
      hostWorktreeRoot: null,
      builtInWorktreeRoot: '/tmp/worktrees',
      homeDirectory: '/tmp',
      hostTmux: null,
      appDefaultTmux: false,
      ...(options.appDefaultTmuxHistoryLimit === undefined
        ? {}
        : { appDefaultTmuxHistoryLimit: options.appDefaultTmuxHistoryLimit }),
    })),
  };
  const repoFacts = { get: vi.fn(async () => ({ remotes: [], localBranches: ['main'] })) };
  const runtimeClient = buildRuntimeClient({
    resolveTmuxDependency: options.resolveTmuxDependency,
  });
  const resolver = new TaskSessionLaunchContextResolver({
    db: {
      select: vi.fn(() =>
        selecting({
          id: 'task-1',
          projectId: 'project-1',
          workspaceId: 'workspace-1',
          name: 'Task',
        })
      ),
    } as never,
    projects: {
      requireAttached: vi.fn(() => ok({ repoPath: '/repo', settings, repoFacts } as never)),
    },
    runtimes: { client: vi.fn(async () => ok(runtimeClient as never)) },
    workspaceIdentity: { resolve: vi.fn(async () => identity) },
  });
  return resolver.bind({ projectId: 'project-1', taskId: 'task-1', workspaceId: 'workspace-1' });
}

describe('TaskSessionLaunchContextResolver', () => {
  it('forces tmux off only for local Windows sessions', () => {
    expect(resolveSessionTmux({ type: 'local', id: 'local' }, true, 'win32')).toBe(false);
    expect(resolveSessionTmux({ type: 'local', id: 'local' }, true, 'darwin')).toBe(true);
    expect(resolveSessionTmux({ type: 'remote', id: 'ssh-1' }, true, 'win32')).toBe(true);
  });

  it('reads mutable launch policy from its authorities on every resolution', async () => {
    let taskName = 'Old task';
    let tmux = false;
    let shellSetup = 'source old-profile';
    let defaultBranch = 'main';
    let projectEnv = {
      CLAUDE_CONFIG_DIR: '/tmp/claude-old',
      EMDASH_TASK_NAME: 'cannot-override',
    };
    const identity = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      host: { type: 'local', id: 'local' } as const,
      path: '/repo/worktree',
    };
    const select = vi.fn(() =>
      selecting({
        id: 'task-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        name: taskName,
      })
    );
    const getProjectConfig = vi.fn(async () =>
      ok({
        resolved: {
          shellSetup: { value: shellSetup, from: 'team' as const },
          env: { value: projectEnv, from: 'personal' as const },
        },
      })
    );
    const settings = {
      resolveTmux: vi.fn(async () => ({
        value: tmux,
        provenance: { kind: 'set' as const },
      })),
      getStoredGitSettings: vi.fn(async () => ({
        defaultBranch: { remote: null, branch: defaultBranch },
      })),
      getPlacementContext: vi.fn(async () => ({
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/tmp/worktrees',
        homeDirectory: '/tmp',
        hostTmux: null,
        appDefaultTmux: false,
      })),
    };
    const repoFacts = {
      get: vi.fn(async () => ({ remotes: [], localBranches: [defaultBranch] })),
    };
    const resolver = new TaskSessionLaunchContextResolver({
      db: { select } as never,
      projects: {
        requireAttached: vi.fn(() =>
          ok({
            repoPath: '/repo',
            settings,
            repoFacts,
          } as never)
        ),
      },
      runtimes: {
        client: vi.fn(async () =>
          ok({
            workspaceRegistry: { getProjectConfig },
            hostDependencies: {
              resolver: { resolve: vi.fn(async () => ok({ id: 'tmux', path: '/usr/bin/tmux' })) },
            },
          } as never)
        ),
      },
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });
    const source = resolver.bind({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    const first = await source.resolve();

    taskName = 'New task';
    tmux = true;
    shellSetup = 'source new-profile';
    defaultBranch = 'trunk';
    projectEnv = {
      CLAUDE_CONFIG_DIR: '/tmp/claude-new',
      EMDASH_TASK_NAME: 'still-cannot-override',
    };
    const second = await source.resolve();

    expect(first).toMatchObject({
      success: true,
      data: {
        tmux: false,
        shellSetup: 'source old-profile',
        env: {
          CLAUDE_CONFIG_DIR: '/tmp/claude-old',
          EMDASH_TASK_NAME: 'old-task',
          EMDASH_DEFAULT_BRANCH: 'main',
        },
      },
    });
    expect(second).toMatchObject({
      success: true,
      data: {
        tmux: true,
        shellSetup: 'source new-profile',
        env: {
          CLAUDE_CONFIG_DIR: '/tmp/claude-new',
          EMDASH_TASK_NAME: 'new-task',
          EMDASH_DEFAULT_BRANCH: 'trunk',
        },
      },
    });
    expect(select).toHaveBeenCalledTimes(2);
    expect(getProjectConfig).toHaveBeenCalledTimes(2);
    expect(settings.resolveTmux).toHaveBeenCalledTimes(2);
  });

  it('does not let a task-bound source silently follow a replacement workspace', async () => {
    const requireAttached = vi.fn();
    const resolver = new TaskSessionLaunchContextResolver({
      db: {
        select: vi.fn(() =>
          selecting({
            id: 'task-1',
            projectId: 'project-1',
            workspaceId: 'workspace-2',
            name: 'Task',
          })
        ),
      } as never,
      projects: { requireAttached },
      runtimes: { client: vi.fn() },
      workspaceIdentity: { resolve: vi.fn() },
    });
    const source = resolver.bind({
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    });

    await expect(source.resolve()).resolves.toEqual({
      success: false,
      error: {
        type: 'missing-workspace',
        message: 'Task task-1 is not bound to workspace workspace-1',
      },
    });
    expect(requireAttached).not.toHaveBeenCalled();
  });

  describe('tmux scrollback', () => {
    it('carries the configured scrollback depth to the session', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
        appDefaultTmuxHistoryLimit: 50_000,
      });

      const result = await source.resolve();

      expect(result).toMatchObject({ success: true, data: { tmuxHistoryLimit: 50_000 } });
    });

    it('omits the depth when unset, so the pty layer default applies', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
      });

      const result = await source.resolve();

      // Absent rather than a restated default: this layer must not have to know what the
      // pty layer's default is, or the two could drift apart.
      expect(result.success).toBe(true);
      if (result.success) expect('tmuxHistoryLimit' in result.data).toBe(false);
    });
  });

  describe('tmux availability gate', () => {
    it('keeps tmux on when requested and the binary is present on the host', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
        resolveTmuxDependency: async () => ok({ id: 'tmux', path: '/usr/bin/tmux' }),
      });

      const result = await source.resolve();

      expect(result).toMatchObject({ success: true, data: { tmux: true, tmuxWarning: undefined } });
    });

    it('falls back to a plain pty and surfaces tmux_missing when the binary is absent', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
        resolveTmuxDependency: async () => err({ type: 'missing', id: 'tmux' }),
      });

      const result = await source.resolve();

      expect(result).toMatchObject({
        success: true,
        data: { tmux: false, tmuxWarning: 'tmux_missing' },
      });
    });

    it('stays off with tmux_unsupported_on_windows on local Windows regardless of the binary', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
        resolveTmuxDependency: async () => ok({ id: 'tmux', path: 'C:\\tmux.exe' }),
      });
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        const result = await source.resolve();
        expect(result).toMatchObject({
          success: true,
          data: { tmux: false, tmuxWarning: 'tmux_unsupported_on_windows' },
        });
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('resolves availability against the remote host, not the desktop', async () => {
      const resolveTmuxDependency = vi.fn(async () => ok({ id: 'tmux', path: '/usr/bin/tmux' }));
      const source = buildResolver({
        host: { type: 'remote', id: 'ssh-1' },
        tmuxRequested: true,
        resolveTmuxDependency,
      });

      const result = await source.resolve();

      expect(result).toMatchObject({ success: true, data: { tmux: true } });
      expect(resolveTmuxDependency).toHaveBeenCalled();
    });

    it('treats a dependency lookup failure as absent rather than a hard error', async () => {
      const source = buildResolver({
        host: { type: 'local', id: 'local' },
        tmuxRequested: true,
        resolveTmuxDependency: async () => {
          throw new Error('probe crashed');
        },
      });

      const result = await source.resolve();

      expect(result).toMatchObject({
        success: true,
        data: { tmux: false, tmuxWarning: 'tmux_missing' },
      });
    });
  });
});

function selecting<T>(row: T) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  };
}

import { resolveTmuxWarning, type LocalPtySpawnWarning } from '@emdash/core/services/pty/api';
import type { HostRuntimesClient, RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { ProjectAttachmentError } from '@core/features/projects/api';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { resolveProjectEffectiveSettings } from '@core/features/projects/api/node/settings/effective-settings';
import { getTaskEnvVars } from '@core/features/workspaces/api/node/workspace-env';
import type {
  WorkspaceIdentity,
  WorkspaceIdentityService,
} from '@core/features/workspaces/api/node/workspace-identity-service';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';

export type TaskSessionLaunchContext = Readonly<{
  workspace: WorkspaceIdentity;
  tmux: boolean;
  tmuxWarning?: LocalPtySpawnWarning;
  shellSetup?: string;
  env: Readonly<Record<string, string>>;
}>;

export type TaskSessionLaunchContextInput = Readonly<{
  projectId: string;
  taskId: string;
  workspaceId?: string;
}>;

export type TaskSessionLaunchContextError =
  | ProjectAttachmentError
  | { type: 'missing-task'; message: string }
  | { type: 'missing-workspace'; message: string };

export type TaskSessionLaunchContextSource = Readonly<{
  resolve(): Promise<Result<TaskSessionLaunchContext, TaskSessionLaunchContextError>>;
}>;

export class TaskSessionLaunchContextResolver {
  constructor(
    private readonly dependencies: Readonly<{
      db: AppDb;
      projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
      runtimes: Pick<RuntimeBroker, 'client'>;
      workspaceIdentity: Pick<WorkspaceIdentityService, 'resolve'>;
    }>
  ) {}

  bind(input: TaskSessionLaunchContextInput): TaskSessionLaunchContextSource {
    return { resolve: () => this.resolve(input) };
  }

  async resolve(
    input: TaskSessionLaunchContextInput
  ): Promise<Result<TaskSessionLaunchContext, TaskSessionLaunchContextError>> {
    const [task] = await this.dependencies.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, input.taskId),
          eq(tasks.projectId, input.projectId),
          isNull(tasks.deletedAt)
        )
      )
      .limit(1);
    if (!task) {
      return err({ type: 'missing-task', message: `Task ${input.taskId} not found` });
    }
    if (!task.workspaceId) {
      return err({
        type: 'missing-workspace',
        message: `Task ${input.taskId} has no workspace`,
      });
    }
    if (input.workspaceId !== undefined && task.workspaceId !== input.workspaceId) {
      return err({
        type: 'missing-workspace',
        message: `Task ${input.taskId} is not bound to workspace ${input.workspaceId}`,
      });
    }

    const project = this.dependencies.projects.requireAttached(input.projectId);
    if (!project.success) return project;

    const identity = await this.dependencies.workspaceIdentity.resolve(task.workspaceId);
    if (!identity || identity.projectId !== input.projectId) {
      return err({
        type: 'missing-workspace',
        message: `Workspace ${task.workspaceId} was not found`,
      });
    }

    const runtime = await this.dependencies.runtimes.client(identity.host);
    if (!runtime.success) return runtime;

    const [effective, tmux, projectConfig, tmuxAvailable] = await Promise.all([
      resolveProjectEffectiveSettings({
        settings: project.data.settings,
        repoFacts: project.data.repoFacts,
      }),
      project.data.settings.resolveTmux(),
      runtime.data.workspaceRegistry.getProjectConfig({ workspaceId: identity.workspaceId }),
      resolveTmuxAvailability(runtime.data.hostDependencies),
    ]);
    if (!projectConfig.success) {
      return err({
        type: 'missing-workspace',
        message: `Workspace ${identity.workspaceId} has no project configuration`,
      });
    }

    const platform = process.platform;
    const isLocalWindows = identity.host.type === 'local' && platform === 'win32';
    const tmuxWarning = resolveTmuxWarning({
      requested: tmux.value,
      available: tmuxAvailable,
      isLocalWindows,
    });

    return ok({
      workspace: identity,
      tmux: resolveSessionTmux(identity.host, tmux.value && tmuxAvailable, platform),
      tmuxWarning,
      shellSetup: projectConfig.data.resolved.shellSetup?.value,
      env: {
        ...projectConfig.data.resolved.env.value,
        ...getTaskEnvVars({
          taskId: task.id,
          taskName: task.name,
          taskPath: identity.path,
          projectPath: project.data.repoPath,
          defaultBranch: effective.defaultBranch.value?.branch ?? null,
          portSeed: identity.path,
        }),
      },
    });
  }
}

/**
 * Resolves whether tmux is available on the session's own host. This is per-host by
 * construction: it goes through the runtime client bound to `identity.host`, so SSH hosts
 * consult their own machine rather than the desktop's. A failed or throwing lookup is treated
 * as "tmux is absent" rather than surfaced as a hard error, so a flaky dependency probe never
 * blocks a session from starting.
 */
async function resolveTmuxAvailability(
  hostDependencies: Pick<HostRuntimesClient['hostDependencies'], 'resolver'>
): Promise<boolean> {
  try {
    const resolved = await hostDependencies.resolver.resolve({ id: 'tmux' });
    return resolved.success;
  } catch {
    return false;
  }
}

export function resolveSessionTmux(
  host: WorkspaceIdentity['host'],
  requested: boolean,
  platform: NodeJS.Platform = process.platform
): boolean {
  return host.type === 'local' && platform === 'win32' ? false : requested;
}

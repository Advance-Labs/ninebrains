import type { CleanArtifactsError } from '@emdash/core/runtimes/workspace-registry/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { PROJECT_LIVE_ACCESS_REQUIRED_MESSAGE } from '@core/features/projects/api/attachments';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import {
  deleteWorkspaceThroughRegistry,
  type WorkspaceRemovalBroker,
  type WorkspaceRemovalResult,
} from '@core/features/workspaces/api/node/operations/workspace-removal';
import type {
  CleanWorkspaceArtifactsInput,
  CleanWorkspaceArtifactsSummary,
} from '@core/features/workspaces/api/wire-contract';
import type { MutationError } from '@core/primitives/wire/api/mutations';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';

export interface WorkspaceMutationOperations {
  delete(input: { workspaceId: string }): Promise<WorkspaceRemovalResult>;
  cleanArtifacts(
    input: CleanWorkspaceArtifactsInput
  ): Promise<Result<CleanWorkspaceArtifactsSummary, MutationError>>;
}

export type WorkspaceProjectResolver = (workspaceId: string) => Promise<string | undefined>;

export interface WorkspaceMutationServiceDependencies {
  db: AppDb;
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  runtimes: WorkspaceRemovalBroker;
  projectIdForWorkspace?: WorkspaceProjectResolver;
}

export class WorkspaceMutationService implements WorkspaceMutationOperations {
  private readonly projectIdForWorkspace: WorkspaceProjectResolver;

  constructor(private readonly dependencies: WorkspaceMutationServiceDependencies) {
    this.projectIdForWorkspace =
      dependencies.projectIdForWorkspace ??
      ((workspaceId) => resolveProjectIdForWorkspace(dependencies.db, workspaceId));
  }

  async delete({ workspaceId }: { workspaceId: string }): Promise<WorkspaceRemovalResult> {
    const projectId = await this.projectIdForWorkspace(workspaceId);
    if (!projectId) {
      return err({
        type: 'project-missing',
        message: 'The Project for this workspace was not found.',
      });
    }
    const attached = this.dependencies.projects.requireAttached(projectId);
    if (!attached.success) return err(attachmentMutationError(attached.error.type));
    return deleteWorkspaceThroughRegistry(
      this.dependencies.db,
      this.dependencies.runtimes,
      workspaceId
    );
  }

  async cleanArtifacts(
    input: CleanWorkspaceArtifactsInput
  ): Promise<Result<CleanWorkspaceArtifactsSummary, MutationError>> {
    const attached = this.dependencies.projects.requireAttached(input.projectId);
    if (!attached.success) return err(attachmentMutationError(attached.error.type));
    const cleaned = await attached.data.workspaceRegistry.cleanArtifacts({
      workspaceId: input.workspaceId,
    });
    if (!cleaned.success) {
      return err({ type: cleaned.error.type, message: describeCleanError(cleaned.error) });
    }
    return ok({
      removed: cleaned.data.removed.length,
      kept: cleaned.data.kept,
      failed: cleaned.data.errors.length,
    });
  }
}

async function resolveProjectIdForWorkspace(
  db: AppDb,
  workspaceId: string
): Promise<string | undefined> {
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return task?.projectId;
}

function attachmentMutationError(type: string): {
  type: 'project-missing' | 'project-unavailable';
  message: string;
} {
  return type === 'project-missing'
    ? { type: 'project-missing', message: 'Project was not found.' }
    : { type: 'project-unavailable', message: PROJECT_LIVE_ACCESS_REQUIRED_MESSAGE };
}

function describeCleanError(error: CleanArtifactsError): string {
  switch (error.type) {
    case 'workspace-not-found':
      return 'Workspace was not found on its host.';
    case 'not-a-worktree':
      return 'Only worktrees can have their artifacts cleaned.';
    case 'workspace-missing':
      return 'The worktree is missing from disk.';
    default:
      return error.message;
  }
}

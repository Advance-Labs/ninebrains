import { randomUUID } from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { CreateConversationParams } from '@core/primitives/conversations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { createTuiAgentFeed } from './agent-feed';
import { lanesEvents } from './event-host';
import type { LaneConversationsPort, LaneProjectsPort, LaneTasksPort } from './lane-ports';
import { LaneService } from './lane-service';
import { createMementoLanePersistence } from './lanes-persistence';

export type NinebrainsServicesDependencies = {
  db: AppDb;
  runtimes: RuntimeBroker;
  scope: Scope;
  logger: Logger;
  taskService: Pick<TaskService, 'createTask' | 'provisionWorkspace' | 'deleteTask'>;
  workspaceIdentity: { resolve(workspaceId: string): Promise<{ host: HostRef } | null> };
  getMementosRuntimeClient(): Promise<MementosRuntimeClient>;
  /**
   * Conversation verbs live in the conversations slice's `node/`, which other
   * slices may not import, so the composition root binds and injects them.
   */
  conversations: {
    create(params: CreateConversationParams): Promise<unknown>;
    launch(input: { projectId: string; taskId: string; conversationId: string }): Promise<unknown>;
  };
};

export type NinebrainsServices = {
  readonly lanes: LaneService;
};

/** One entry point so the upstream `services.ts` patch stays a single call. */
export function createNinebrainsServices(deps: NinebrainsServicesDependencies): NinebrainsServices {
  const onError = (context: string, error: unknown) =>
    deps.logger.warn(context, { error: error instanceof Error ? error.message : String(error) });
  const lanes = new LaneService(
    {
      projects: createProjectsPort(deps),
      tasks: createTasksPort(deps),
      conversations: createConversationsPort(deps),
      persistence: createMementoLanePersistence({
        getClient: deps.getMementosRuntimeClient,
        scope: deps.scope,
      }),
      agentFeed: createTuiAgentFeed({ runtimes: deps.runtimes, onError }),
      newId: () => randomUUID(),
      onError,
    },
    (event) => lanesEvents.emit(undefined, event)
  );
  deps.scope.add(() => lanes.dispose());
  void lanes.initialize().catch((error: unknown) => onError('lanes: initialize failed', error));
  return { lanes };
}

function createProjectsPort(deps: NinebrainsServicesDependencies): LaneProjectsPort {
  return {
    async get(projectId) {
      const [row] = await deps.db
        .select({
          id: projects.id,
          name: projects.name,
          baseRef: projects.baseRef,
          repositoryWorkspaceId: projects.repositoryWorkspaceId,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
      if (!row) return null;
      const identity = row.repositoryWorkspaceId
        ? await deps.workspaceIdentity.resolve(row.repositoryWorkspaceId)
        : null;
      return {
        projectId: row.id,
        name: row.name,
        host: identity?.host.type === 'remote' ? 'remote' : 'local',
        baseRef: row.baseRef,
      };
    },
  };
}

function createTasksPort(deps: NinebrainsServicesDependencies): LaneTasksPort {
  return {
    async createWorktreeTask({ taskId, projectId, name, branchName, baseRef }) {
      const result = await deps.taskService.createTask({
        id: taskId,
        projectId,
        taskConfig: { version: '1', name },
        workspaceConfig: {
          version: '2',
          git: {
            kind: 'create-branch',
            branchName,
            fromBranch: { type: 'local', branch: baseRef },
          },
          workspace: { kind: 'new-worktree' },
        },
      });
      if (result.success) return ok(undefined);
      const error = result.error;
      return err('message' in error && error.message ? error.message : error.type);
    },
    async provision(taskId) {
      const result = await deps.taskService.provisionWorkspace(taskId);
      if (result.success) return ok({ path: result.data.path });
      const error = result.error;
      return err('message' in error && error.message ? error.message : error.type);
    },
    async deleteTask(projectId, taskId, { deleteWorktree }) {
      await deps.taskService.deleteTask(projectId, taskId, {
        deleteWorktree,
        deleteConversations: true,
      });
    },
  };
}

function createConversationsPort(deps: NinebrainsServicesDependencies): LaneConversationsPort {
  return {
    async create({ conversationId, projectId, taskId, provider, model, title }) {
      await deps.conversations.create({
        id: conversationId,
        projectId,
        taskId,
        provider,
        title,
        type: 'pty',
        // Brain-created and lane conversations never skip permissions.
        autoApprove: false,
        ...(model ? { model } : {}),
      });
    },
    async launch(input) {
      await deps.conversations.launch(input);
    },
    async stop(conversationId) {
      const client = await deps.runtimes.client(LOCAL_HOST_REF);
      if (!client.success) throw new Error('The local runtime is unavailable.');
      const stopped = await client.data.tuiAgents.stop({ conversationId });
      if (!stopped.success) throw new Error(`stop failed: ${JSON.stringify(stopped.error)}`);
    },
  };
}

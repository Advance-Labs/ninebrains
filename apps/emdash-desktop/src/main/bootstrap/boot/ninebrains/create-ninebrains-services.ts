import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { Result } from '@emdash/shared';
import { Brain, type GateFloorResolver } from '@ninebrains/brain-core';
import { app } from 'electron';
import { BRAIN_DB_FILENAME, openBrainStore } from '@core/features/brain/node/brain-db';
import {
  BrainService,
  type BrainLaneInfo,
  type BrainLanesPort,
} from '@core/features/brain/node/brain-service';
import { startBrainEndpoint } from '@core/features/brain/node/endpoint';
import { createMementoBrainSessionsPersistence } from '@core/features/brain/node/sessions-persistence';
import type { GateRunnerPort } from '@core/features/brain/node/verification';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import type { LaneService } from '@core/features/lanes/node/lane-service';
import {
  createConversationsPort,
  createLaneService,
  createProjectsPort,
  createTasksPort,
  type LaneServicesDependencies,
} from '@core/features/lanes/node/ninebrains-services';
import { createPacksService, type PacksService } from '@core/features/packs/node/packs-service';
import { createMementoPackPrefsStore } from '@core/features/packs/node/prefs-store';
import { createEnvSecretResolver } from '@core/features/packs/node/secrets';
import { createRuntimeSkillsPort } from '@core/features/packs/node/skills-runtime-port';
import { createBrainPlanTarget } from '@core/features/planner/node/brain-plan-target';
import { createMementoCanvasStore } from '@core/features/planner/node/canvas-store';
import {
  createPlannerService,
  type PlannerService,
} from '@core/features/planner/node/planner-service';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { resolveBrainMcpBin } from './brain-mcp-bin';
import { createKeychainSecretResolver } from './keychain-secret-resolver';
import { createMementoRowPort } from './memento-row-port';

/** What upstream passes to `resolveLaneLaunch` (the patched TuiConversationProvider). */
export type NinebrainsLaunchInput = {
  extraArgs: readonly string[];
  autoApprove: boolean;
  cwd: string;
};

export type NinebrainsServicesDependencies = LaneServicesDependencies & {
  /** The host-dependencies resolver: absolute CLI paths for unattended runs (SEC-16). */
  hostDependencies: {
    resolver: {
      resolve(input: { id: string }): Promise<Result<{ path: string }, unknown>>;
    };
  };
  /**
   * Optional until the gates slice (w5-gates-wiring) lands `createGateRunnerService` and
   * `resolveGateFloor`. Without them a verifying job is marked done **unverified** and the
   * Brain uses brain-core's default (empty) gate floor.
   */
  gateRunner?: GateRunnerPort;
  resolveGateFloor?: GateFloorResolver;
};

export type NinebrainsServices = {
  readonly lanes: LaneService;
  readonly brain: BrainService;
  readonly packs: PacksService;
  readonly planner: PlannerService;
  resolveLaneLaunch(
    conversationId: string,
    upstream: NinebrainsLaunchInput
  ): { extraArgs: string[]; providerVars: Record<string, string> } | undefined;
};

/**
 * The one Ninebrains factory `services.ts` calls: the Brain DB and endpoint,
 * the exec supervisor, packs, planner, lanes and the Brain service. Lanes and
 * the Brain may not import each other's `node/`, so they meet here through
 * narrow ports, with a late binding for the lanes side.
 */
export async function createNinebrainsServices(
  deps: NinebrainsServicesDependencies
): Promise<NinebrainsServices> {
  const onError = (context: string, error: unknown) =>
    deps.logger.warn(context, { error: error instanceof Error ? error.message : String(error) });
  const userDataDir = app.getPath('userData');

  const opened = openBrainStore(join(userDataDir, BRAIN_DB_FILENAME));
  const brain = new Brain({
    store: opened.store,
    resolveGateFloor: deps.resolveGateFloor,
    onListenerError: (error) => onError('brain: event listener failed', error),
  });
  const endpoint = await startBrainEndpoint({
    brain,
    onInternalError: (error) => onError('brain: endpoint internal error', error),
  });

  const packs = createPacksService({
    prefs: createMementoPackPrefsStore(deps.getMementosRuntimeClient),
    secrets: createKeychainSecretResolver(
      encryptedAppSecretsStore,
      createEnvSecretResolver(process.env)
    ),
    skills: createRuntimeSkillsPort(deps.runtimes),
    userPacksDir: join(userDataDir, 'ninebrains', 'packs'),
    onWarning: (message) => deps.logger.warn(message),
  });

  let lanes: LaneService | null = null;
  const laneInfos = (): BrainLaneInfo[] => {
    if (!lanes) return [];
    const service = lanes;
    return service.boardSnapshot().tabs.flatMap((tab) =>
      tab.slots.flatMap((lane) =>
        lane
          ? [
              {
                laneId: lane.laneId,
                projectId: lane.projectId,
                provider: lane.provider,
                taskId: lane.taskId,
                conversationId: lane.conversationId,
                asleep: lane.asleep,
                sessionRunning: lane.session === 'running',
                agent: service.agentStateOf(lane.conversationId),
                worktreePath: service.worktreePathOf(lane.laneId),
              },
            ]
          : []
      )
    );
  };

  const supervisor = new ExecRunSupervisor({
    userDataDir,
    resolveBinary: async (provider) => {
      const resolved = await deps.hostDependencies.resolver.resolve({ id: provider });
      if (!resolved.success) throw new Error(`${provider} is not installed on this machine.`);
      return resolved.data.path;
    },
    allowedRoots: () => laneInfos().flatMap((lane) => lane.worktreePath ?? []),
    maxConcurrentRuns: 4,
  });

  const brainLanes: BrainLanesPort = {
    list: laneInfos,
    async sendInput(conversationId, data) {
      const client = await deps.runtimes.client(LOCAL_HOST_REF);
      if (!client.success) throw new Error('The local runtime is unavailable.');
      const sent = await client.data.tuiAgents.sendInput({ conversationId, data });
      if (!sent.success) throw new Error(`input failed: ${JSON.stringify(sent.error)}`);
    },
    async stop(laneId) {
      const stopped = await lanes?.stopLane(laneId);
      if (stopped && !stopped.success) throw new Error(stopped.error.message);
    },
    subscribe: (listener) => lanes?.onChange(listener) ?? (() => {}),
    refresh: () => lanes?.refresh(),
  };

  const brainService = new BrainService({
    brain,
    endpoint,
    userDataDir,
    brainMcp: { execPath: process.execPath, binPath: resolveBrainMcpBin(app.getAppPath()) },
    lanes: brainLanes,
    sessions: {
      projects: createProjectsPort(deps),
      tasks: createTasksPort(deps),
      conversations: createConversationsPort(deps),
      persistence: createMementoBrainSessionsPersistence({
        getClient: deps.getMementosRuntimeClient,
        scope: deps.scope,
      }),
      newId: () => randomUUID(),
      onError,
    },
    supervisor,
    packs,
    gateRunner: deps.gateRunner,
    onError,
  });
  lanes = createLaneService(deps, brainService.laneBrainPort());
  brainService.start();

  const planner = createPlannerService({
    canvasStore: createMementoCanvasStore(
      createMementoRowPort({ getClient: deps.getMementosRuntimeClient, scope: deps.scope })
    ),
    planTarget: createBrainPlanTarget(brain),
  });

  deps.scope.add(async () => {
    await brainService.dispose();
    opened.close();
  });

  const laneService = lanes;
  return {
    lanes: laneService,
    brain: brainService,
    packs,
    planner,
    resolveLaneLaunch: (conversationId, upstream) =>
      brainService.resolveSessionLaunch(conversationId, upstream) ??
      laneService.resolveLaneLaunch(conversationId, upstream),
  };
}

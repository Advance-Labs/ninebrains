import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { Result } from '@emdash/shared';
import { Brain } from '@ninebrains/brain-core';
import { eq } from 'drizzle-orm';
import { app } from 'electron';
import { BRAIN_DB_FILENAME, openBrainStore } from '@core/features/brain/node/brain-db';
import {
  BrainService,
  type BrainLaneInfo,
  type BrainLanesPort,
} from '@core/features/brain/node/brain-service';
import { startBrainEndpoint } from '@core/features/brain/node/endpoint';
import { createMementoBrainSessionsPersistence } from '@core/features/brain/node/sessions-persistence';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import type { ExecProvider } from '@core/features/exec-runs/api/node/types';
import { createFetchText } from '@core/features/gates/node/capabilities/fetch-text';
import { createPrepareReviewCheckout } from '@core/features/gates/node/capabilities/review-checkout';
import { createRunCommand } from '@core/features/gates/node/capabilities/run-command';
import { createSpawnReviewer } from '@core/features/gates/node/capabilities/spawn-reviewer';
import { createGateRigor, createGatesServices } from '@core/features/gates/node/gates-services';
import { createMementoProjectPrefsStore } from '@core/features/gates/node/rigor/project-prefs';
import type { GateLaneTarget, NotificationPublisher } from '@core/features/gates/node/runner/ports';
import type { GatesVerificationService } from '@core/features/gates/node/verification-service';
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
import type { PreviewServerAccessOperations } from '@core/features/preview-servers/node/preview-server-access-service';
import { previewServerUrl } from '@core/primitives/preview-servers/api';
import { tasks } from '@core/services/app-db/node/schema';
import type { AppSettingsService } from '@core/services/settings/node/app-settings-service';
import { createElectronCdpGateHost } from '@main/host/ninebrains/electron-gate-host';
import { encryptedAppSecretsStore } from '@main/host/secrets/encrypted-app-secrets-store';
import { resolveBrainMcpBin } from './brain-mcp-bin';
import { createKeychainSecretResolver } from './keychain-secret-resolver';
import { createMementoRowPort } from './memento-row-port';
import { routeReviewer } from './reviewer-route';

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
  /** Source of the `ninebrains.gates` rigor settings. */
  appSettings: Pick<AppSettingsService, 'get' | 'on' | 'off'>;
  /** A lane's preview URL for the screenshot gate comes from its task workspace's servers. */
  previewServers: Pick<PreviewServerAccessOperations, 'listForWorkspace'>;
  /** Late-bound: the notification service is built after this factory runs. */
  notifications: () => NotificationPublisher;
};

export type NinebrainsServices = {
  readonly lanes: LaneService;
  readonly brain: BrainService;
  readonly packs: PacksService;
  readonly planner: PlannerService;
  readonly gates: GatesVerificationService;
  resolveLaneLaunch(
    conversationId: string,
    upstream: NinebrainsLaunchInput
  ): { extraArgs: string[]; providerVars: Record<string, string> } | undefined;
};

const isInside = (path: string, root: string) => path === root || path.startsWith(root + sep);

/**
 * The one Ninebrains factory `services.ts` calls: the Brain DB and endpoint,
 * the exec supervisor, packs, planner, lanes, the Brain service and the gates.
 * Lanes and the Brain may not import each other's `node/`, so they meet here
 * through narrow ports, with a late binding for the lanes side.
 */
export async function createNinebrainsServices(
  deps: NinebrainsServicesDependencies
): Promise<NinebrainsServices> {
  const onError = (context: string, error: unknown) =>
    deps.logger.warn(context, { error: error instanceof Error ? error.message : String(error) });
  const userDataDir = app.getPath('userData');

  // The Brain needs the gate floor at construction, so rigor comes first.
  const rigor = createGateRigor({
    settings: {
      get: () => deps.appSettings.get('ninebrains.gates'),
      onChange: (fn) => {
        const listener = (key: string) => key === 'ninebrains.gates' && fn();
        deps.appSettings.on('app-settings:changed', listener);
        return () => deps.appSettings.off('app-settings:changed', listener);
      },
    },
    prefs: createMementoProjectPrefsStore(deps.getMementosRuntimeClient),
    onError,
  });

  const opened = openBrainStore(join(userDataDir, BRAIN_DB_FILENAME));
  const brain = new Brain({
    store: opened.store,
    resolveGateFloor: rigor.resolveGateFloor,
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
  const laneWorktrees = () => laneInfos().flatMap((lane) => lane.worktreePath ?? []);

  // Review checkouts live outside <userData>: gate commands run in them, and M4 denies all of
  // <userData> to gate commands. realpath, because macOS's tmpdir is a symlink into /private.
  const checkoutRoot = join(realpathSync(tmpdir()), 'ninebrains-review');
  mkdirSync(checkoutRoot, { recursive: true, mode: 0o700 });

  const supervisor = new ExecRunSupervisor({
    userDataDir,
    resolveBinary: async (provider) => {
      const resolved = await deps.hostDependencies.resolver.resolve({ id: provider });
      if (!resolved.success) throw new Error(`${provider} is not installed on this machine.`);
      return resolved.data.path;
    },
    allowedRoots: () => [...laneWorktrees(), checkoutRoot],
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
    // The gates below own `verifying` jobs.
    verification: 'external',
    onError,
  });
  lanes = createLaneService(deps, brainService.laneBrainPort());
  brainService.start();

  const previewUrlOf = async (projectId: string, taskId: string) => {
    const [row] = await deps.db
      .select({ workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!row?.workspaceId) return undefined;
    const listed = await deps.previewServers.listForWorkspace({
      projectId,
      workspaceId: row.workspaceId,
    });
    if (!listed.success) return undefined;
    for (const server of listed.data) {
      const url = previewServerUrl(server);
      if (url) return url;
    }
    return undefined;
  };

  // Which CLIs are installed, for the reviewer route. Resolved once at boot.
  const installed = new Set<ExecProvider>();
  for (const provider of ['claude', 'codex'] as const) {
    void deps.hostDependencies.resolver
      .resolve({ id: provider })
      .then((resolved) => resolved.success && installed.add(provider))
      .catch(() => undefined);
  }

  // Every lookup below goes through lane state in main, never the job record (SEC-18).
  const laneOfJob = (jobId: string) => {
    const laneId = brain.store.getJob(jobId)?.laneId;
    return laneId ? lanes?.getLane(laneId) : undefined;
  };

  const gates = createGatesServices({
    brain,
    rigor,
    userDataDir,
    lanes: {
      async resolve(laneId): Promise<GateLaneTarget | undefined> {
        const lane = lanes?.getLane(laneId);
        const worktreePath = lanes?.worktreePathOf(laneId);
        if (!lane || !worktreePath) return undefined;
        const previewUrl = await previewUrlOf(lane.projectId, lane.taskId).catch(
          (error: unknown) => {
            onError('gates: preview lookup failed', error);
            return undefined;
          }
        );
        return {
          laneId,
          projectId: lane.projectId,
          worktreePath,
          browserId: lane.browserId,
          previewUrl,
        };
      },
    },
    capabilities: {
      runCommand: createRunCommand({
        allowedRoots: () => [...laneWorktrees(), checkoutRoot],
        ninebrainsDataDir: join(userDataDir, 'ninebrains'),
        userDataDir,
        siblingWorktrees: (cwd) => laneWorktrees().filter((root) => !isInside(cwd, root)),
        deniedPaths: () => [checkoutRoot],
      }),
      spawnReviewer: createSpawnReviewer({
        supervisor,
        route: (purpose) => routeReviewer(purpose, installed),
        checkoutRoot,
        laneWorktrees,
      }),
      prepareReviewCheckout: createPrepareReviewCheckout({
        worktreeForJob: (job) => {
          const lane = laneOfJob(job.id);
          const worktree = lane ? lanes?.worktreePathOf(lane.laneId) : null;
          if (!worktree) throw new Error(`Job ${job.id} has no lane worktree to review.`);
          return worktree;
        },
        root: checkoutRoot,
      }),
      fetchText: createFetchText(),
    },
    screenshots: createElectronCdpGateHost(),
    extraGates: () => packs.createGates(),
    notifications: { publish: (input) => deps.notifications().publish(input) },
    resolveNotificationTarget: async (job) => {
      const lane = laneOfJob(job.id);
      return lane
        ? {
            kind: 'task',
            projectId: lane.projectId,
            taskId: lane.taskId,
            conversationId: lane.conversationId,
          }
        : undefined;
    },
    onError,
  });
  await gates.start();

  const planner = createPlannerService({
    canvasStore: createMementoCanvasStore(
      createMementoRowPort({ getClient: deps.getMementosRuntimeClient, scope: deps.scope })
    ),
    planTarget: createBrainPlanTarget(brain),
  });

  deps.scope.add(async () => {
    gates.dispose();
    await brainService.dispose();
    opened.close();
  });

  const laneService = lanes;
  return {
    lanes: laneService,
    brain: brainService,
    packs,
    planner,
    gates: gates.verification,
    resolveLaneLaunch: (conversationId, upstream) =>
      brainService.resolveSessionLaunch(conversationId, upstream) ??
      laneService.resolveLaneLaunch(conversationId, upstream),
  };
}

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Gate, GateContext, GateResult } from '@emdash/gates-core';
import {
  Brain,
  InMemoryBrainStore,
  type GateSpec,
  type Identity,
  type Job,
} from '@ninebrains/brain-core';
import type { PublishNotification } from '@core/services/notifications/api';
import { DEFAULT_GATES_SETTINGS, type GatesSettings } from '../../contributions/settings';
import { installJobBlockedNotifications } from '../notifications/job-blocked';
import { createMemoryProjectPrefsStore, type ProjectGatePrefs } from '../rigor/project-prefs';
import { RigorResolver } from '../rigor/rigor';
import { GateRunnerService, type GateRunnerDeps } from './gate-runner';
import type { GateRunnerCapabilities, ScreenshotHost } from './ports';

export const PROJECT = 'p1';
export const LANE_ID = 'lane1';
export const LANE: Identity = { role: 'lane', laneId: LANE_ID, projectId: PROJECT };
export const BRAIN: Identity = { role: 'brain', brainId: 'main' };

export function fakeCapabilities(
  overrides: Partial<GateRunnerCapabilities> = {},
  checkoutPath = tmpdir()
): GateRunnerCapabilities {
  return {
    runCommand: async () => ({ exitCode: 0, stdout: 'all tests passed', stderr: '' }),
    spawnReviewer: async () => ({ text: '{"pass": true, "issues": []}' }),
    prepareReviewCheckout: async () => ({ path: checkoutPath, dispose: async () => undefined }),
    fetchText: async () => '',
    ...overrides,
  };
}

export type ScriptedGate = Gate & { calls: number; seen: GateContext[] };

/** A gate that passes or fails per call (last outcome repeats) and writes one log each time. */
export function scriptedGate(
  id: string,
  outcomes: boolean[],
  run?: (ctx: GateContext) => Promise<GateResult>
): ScriptedGate {
  const gate: ScriptedGate = {
    id,
    title: `Gate ${id}`,
    calls: 0,
    seen: [],
    appliesTo: () => true,
    async run(ctx) {
      gate.seen.push(ctx);
      const pass = outcomes[Math.min(gate.calls, outcomes.length - 1)] ?? false;
      gate.calls += 1;
      if (run) return run(ctx);
      const log = await ctx.evidence.put({
        kind: 'log',
        label: `${id} log`,
        fileName: `${id}.log`,
        data: `${id} ${pass ? 'ok' : 'broken'}`,
      });
      return { pass, evidence: [log], feedback: pass ? `${id} ok` : `${id} found a problem` };
    },
  };
  return gate;
}

export async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export interface GateFixtureOptions {
  settings?: Partial<GatesSettings>;
  prefs?: Partial<ProjectGatePrefs>;
  /** Replaces the gates-core built-ins. */
  gates?: Gate[];
  extraGates?: Gate[];
  capabilities?: Partial<GateRunnerCapabilities>;
  screenshots?: ScreenshotHost;
  previewUrl?: string;
  laneAvailable?: boolean;
}

export type GateFixture = Awaited<ReturnType<typeof createGateFixture>>;

/** A real Brain on the in-memory store, a lane in project p1, and a runner wired to it. */
export async function createGateFixture(options: GateFixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nb-gates-'));
  const evidenceRoot = join(root, 'user-data', 'ninebrains', 'evidence');
  const worktree = join(root, 'worktree');
  await mkdir(worktree, { recursive: true });

  const rigor = new RigorResolver({
    settings: { get: async () => ({ ...DEFAULT_GATES_SETTINGS, ...options.settings }) },
    prefs: createMemoryProjectPrefsStore(options.prefs ? { [PROJECT]: options.prefs } : {}),
  });
  await rigor.refresh();

  let clock = 1_000;
  const now = () => ++clock;
  const brain = new Brain({
    store: new InMemoryBrainStore(),
    now,
    resolveGateFloor: rigor.resolveGateFloor,
  });
  brain.upsertLane(BRAIN, { id: LANE_ID, projectId: PROJECT, provider: 'claude', status: 'idle' });

  const notifications: PublishNotification[] = [];
  const stopNotifications = installJobBlockedNotifications(
    {
      publish: (input) => {
        notifications.push(input);
        return String(notifications.length);
      },
    },
    { events: brain.events }
  );

  const makeRunner = (overrides: Partial<GateRunnerDeps> = {}) =>
    new GateRunnerService({
      brain,
      lanes: {
        resolve: async (laneId) =>
          options.laneAvailable === false || laneId !== LANE_ID
            ? undefined
            : {
                laneId,
                projectId: PROJECT,
                worktreePath: worktree,
                previewUrl: options.previewUrl,
                browserId: 'browser-lane1',
              },
      },
      rigor,
      capabilities: fakeCapabilities(options.capabilities, worktree),
      screenshots: options.screenshots,
      ...(options.gates ? { builtInGates: () => options.gates ?? [] } : {}),
      extraGates: () => options.extraGates ?? [],
      evidenceRoot,
      now,
      ...overrides,
    });
  const runner = makeRunner();

  /** Creates a job and drives it to `verifying` through the lane. */
  function createJob(gateSpec: GateSpec | null = null, title = 'Build the landing page'): Job {
    const job = brain.createJob(BRAIN, {
      projectId: PROJECT,
      title,
      body: 'Make it responsive.',
      gateSpec,
    });
    brain.claimJob(LANE, job.id, { start: true });
    brain.completeJob(LANE, job.id, { summary: 'done', artifacts: ['proof.png'] });
    return brain.getJob(BRAIN, job.id);
  }

  /** The lane calls complete_job again after a retry. */
  function resubmit(jobId: string): void {
    brain.completeJob(LANE, jobId, { summary: 'fixed it' });
  }

  return {
    root,
    evidenceRoot,
    worktree,
    brain,
    rigor,
    runner,
    makeRunner,
    notifications,
    createJob,
    resubmit,
    job: (id: string) => brain.getJob(BRAIN, id),
    async dispose() {
      runner.stop();
      stopNotifications();
      await rm(root, { recursive: true, force: true });
    },
  };
}

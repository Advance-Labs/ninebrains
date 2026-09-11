/**
 * The two factories the composition root calls. Two steps, because brain-core
 * needs the gate floor at construction and the runner needs the Brain:
 *
 *   const rigor = createGateRigor({ settings, prefs });
 *   const brain = new Brain({ store, resolveGateFloor: rigor.resolveGateFloor });
 *   const gates = createGatesServices({ brain, rigor, lanes, capabilities, ... });
 *   await gates.start();
 *
 * See the README, "Wiring", for the full `services.ts` snippet.
 */
import { join } from 'node:path';
import type { Gate } from '@emdash/gates-core';
import type { Job } from '@ninebrains/brain-core';
import type { NotificationTarget } from '@core/services/notifications/api';
import { sweepEvidence } from './evidence/evidence';
import { installJobBlockedNotifications } from './notifications/job-blocked';
import type { ProjectPrefsStore } from './rigor/project-prefs';
import { RigorResolver, type GatesSettingsSource } from './rigor/rigor';
import { GateRunnerService, type GateRunnerBrain } from './runner/gate-runner';
import type {
  GateLaneResolver,
  GateRunnerCapabilities,
  NotificationPublisher,
  ScreenshotHost,
} from './runner/ports';
import { createVerificationService, type GatesVerificationService } from './verification-service';

const DAY_MS = 24 * 60 * 60 * 1000;

export function createGateRigor(deps: {
  settings: GatesSettingsSource;
  prefs: ProjectPrefsStore;
  onError?: (context: string, error: unknown) => void;
}): RigorResolver {
  return new RigorResolver(deps);
}

export interface GatesServicesDeps {
  brain: GateRunnerBrain;
  rigor: RigorResolver;
  lanes: GateLaneResolver;
  capabilities: GateRunnerCapabilities;
  screenshots?: ScreenshotHost;
  /** `packs.createGates()`. */
  extraGates?: () => Gate[];
  /** `app.getPath('userData')`. Evidence lives in `<userData>/ninebrains/evidence`. */
  userDataDir: string;
  notifications?: NotificationPublisher;
  /** Maps a blocked job's lane to its Emdash task, so the notification opens it. */
  resolveNotificationTarget?: (job: Job) => Promise<NotificationTarget | undefined>;
  /** How often the retention sweep runs. Default 6 hours. */
  sweepIntervalMs?: number;
  onError?: (context: string, error: unknown) => void;
}

export interface GatesServices {
  readonly rigor: RigorResolver;
  readonly runner: GateRunnerService;
  readonly verification: GatesVerificationService;
  readonly evidenceRoot: string;
  /** Loads rigor, starts the runner (and its crash-recovery sweep), notifications and retention. */
  start(): Promise<void>;
  dispose(): void;
}

export function createGatesServices(deps: GatesServicesDeps): GatesServices {
  const evidenceRoot = join(deps.userDataDir, 'ninebrains', 'evidence');
  const onError = deps.onError ?? (() => undefined);
  const runner = new GateRunnerService({
    brain: deps.brain,
    lanes: deps.lanes,
    rigor: deps.rigor,
    capabilities: deps.capabilities,
    screenshots: deps.screenshots,
    extraGates: deps.extraGates,
    evidenceRoot,
    onError,
  });
  const disposers: Array<() => void> = [];

  const sweep = () =>
    void sweepEvidence(evidenceRoot, {
      maxAgeMs: deps.rigor.settings.evidenceRetentionDays * DAY_MS,
    }).catch((error: unknown) => onError('gates: evidence sweep failed', error));

  return {
    rigor: deps.rigor,
    runner,
    verification: createVerificationService({ brain: deps.brain, evidenceRoot }),
    evidenceRoot,
    async start() {
      await deps.rigor.refresh();
      disposers.push(deps.rigor.watch());
      if (deps.notifications) {
        disposers.push(
          installJobBlockedNotifications(deps.notifications, {
            events: deps.brain.events,
            resolveTarget: deps.resolveNotificationTarget,
            onError,
          })
        );
      }
      runner.start();
      disposers.push(() => runner.stop());
      sweep();
      const timer = setInterval(sweep, deps.sweepIntervalMs ?? 6 * 60 * 60 * 1000);
      timer.unref?.();
      disposers.push(() => clearInterval(timer));
    },
    dispose() {
      while (disposers.length > 0) disposers.pop()?.();
    },
  };
}

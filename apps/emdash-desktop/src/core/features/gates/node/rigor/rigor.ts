/**
 * Rigor sliders → the gate floor (plan 4.5, SEAMS §3.15).
 *
 * brain-core calls `resolveGateFloor` synchronously inside its transactions, so
 * this keeps a cache of the app setting and every project override, loaded by
 * `refresh()` at boot and again whenever either changes. Project override >
 * app setting > defaults.
 */
import { rigorToGates, type JobKind as GateJobKind, type Rigor } from '@emdash/gates-core';
import type { GateSpec, JobKind as BrainJobKind, ProjectId } from '@ninebrains/brain-core';
import {
  DEFAULT_GATES_SETTINGS,
  gatesSettingsSchema,
  type GatesSettings,
} from '../../contributions/settings';
import {
  EMPTY_PROJECT_PREFS,
  type ProjectGatePrefs,
  type ProjectPrefsStore,
} from './project-prefs';

export const GATE_JOB_KINDS: readonly GateJobKind[] = ['code', 'ui', 'research', 'seo', 'docs'];

/**
 * The gates-core job kind lives in the job's gate spec (`gateSpec.kind`). A spec
 * without one is treated as `code`, the kind with the widest default floor
 * among non-UI work.
 */
export function gateJobKindOf(spec: GateSpec | null | undefined): GateJobKind {
  const kind = spec?.kind;
  return typeof kind === 'string' && (GATE_JOB_KINDS as readonly string[]).includes(kind)
    ? (kind as GateJobKind)
    : 'code';
}

export interface EffectiveRigor extends Rigor {
  source: { testing: 'project' | 'app'; security: 'project' | 'app' };
}

/** Reads the `ninebrains.gates` app setting. Adapt `AppSettingsService` to it at wiring time. */
export interface GatesSettingsSource {
  get(): Promise<GatesSettings>;
  /** Returns an unsubscribe function. */
  onChange?(listener: () => void): () => void;
}

export interface RigorResolverDeps {
  settings: GatesSettingsSource;
  prefs: ProjectPrefsStore;
  onError?: (context: string, error: unknown) => void;
}

export class RigorResolver {
  private app: GatesSettings = DEFAULT_GATES_SETTINGS;
  private readonly projects = new Map<string, ProjectGatePrefs>();

  constructor(private readonly deps: RigorResolverDeps) {}

  /** Loads the app setting and every stored project override. */
  async refresh(): Promise<void> {
    const parsed = gatesSettingsSchema.safeParse(await this.deps.settings.get());
    this.app = parsed.success ? parsed.data : DEFAULT_GATES_SETTINGS;
    const ids = await this.deps.prefs.listProjects();
    const entries = await Promise.all(
      ids.map(async (id) => [id, await this.deps.prefs.get(id)] as const)
    );
    this.projects.clear();
    for (const [id, prefs] of entries) this.projects.set(id, prefs);
  }

  /** Re-reads the cache whenever the app setting changes. Returns the unsubscribe function. */
  watch(): () => void {
    return (
      this.deps.settings.onChange?.(() => {
        void this.refresh().catch((error: unknown) =>
          this.deps.onError?.('gates: rigor refresh failed', error)
        );
      }) ?? (() => undefined)
    );
  }

  get settings(): GatesSettings {
    return this.app;
  }

  projectPrefs(projectId: string): ProjectGatePrefs {
    return { ...(this.projects.get(projectId) ?? EMPTY_PROJECT_PREFS) };
  }

  async setProjectPrefs(projectId: string, prefs: ProjectGatePrefs): Promise<void> {
    await this.deps.prefs.set(projectId, prefs);
    this.projects.set(projectId, { ...prefs });
  }

  rigorFor(projectId: string): EffectiveRigor {
    const project = this.projects.get(projectId);
    return {
      testing: project?.testingRigor ?? this.app.testingRigor,
      security: project?.securityRigor ?? this.app.securityRigor,
      source: {
        testing: project?.testingRigor != null ? 'project' : 'app',
        security: project?.securityRigor != null ? 'project' : 'app',
      },
    };
  }

  /**
   * SEC-08 floor for brain-core's `new Brain({ resolveGateFloor })`. The Brain's
   * own kind (`work | review`) doesn't say whether a job is UI work, so the
   * gates-core kind comes from the requested spec.
   */
  readonly resolveGateFloor = (
    projectId: ProjectId,
    _kind: BrainJobKind,
    requested: GateSpec | null
  ): string[] => rigorToGates(this.rigorFor(projectId), gateJobKindOf(requested));
}

import type { Gate } from '@emdash/gates-core';
import { err, ok, type Result } from '@emdash/shared';
import type { SkillsRuntimeBroker } from '@core/features/skills/api/runtime-adapter';
import type { PacksError, PacksListing, PackSummary } from '../api/contract';
import type { McpServerEntry, PackLaunch } from '../api/launch';
import { bundledPacks as defaultBundledPacks, type BundledPack } from './bundled';
import { KNOWN_GATE_IDS } from './gate-ids';
import { seoEvidenceGate } from './gates/seo-evidence-gate';
import { loadPacks, type LoadedPack, type PackFs, type PackLoadResult } from './loader';
import {
  createMementoPackPrefsStore,
  type PackPrefsMementoClient,
  type PackPrefsStore,
} from './prefs-store';
import { resolvePackLaunch } from './resolve-launch';
import { unconfiguredSecretResolver, type SecretResolver } from './secrets';
import { createRuntimeSkillsPort } from './skills-runtime-port';
import {
  desiredPackSkills,
  packSkillInstallId,
  syncPackSkills,
  type SkillSyncReport,
  type SkillsPort,
} from './skills-sync';

export interface PacksServiceDeps {
  prefs: PackPrefsStore;
  secrets: SecretResolver;
  /** Omit to skip skill installation (tests, remote hosts). */
  skills?: SkillsPort;
  /** `<userData>/ninebrains/packs`. Omit to load bundled packs only. */
  userPacksDir?: string;
  fs?: PackFs;
  bundled?: readonly BundledPack[];
  onWarning?: (message: string) => void;
}

export interface PacksService {
  list(projectId: string | null): Promise<PacksListing>;
  setEnabled(
    projectId: string,
    packId: string,
    enabled: boolean
  ): Promise<Result<{ enabledPackIds: string[] }, PacksError>>;
  /** Merged into a lane's launch config by the Phase-2 launch builder. */
  resolvePackLaunch(projectId: string, roleId?: string): Promise<PackLaunch>;
  /** Installs skills of packs enabled anywhere; removes stale `nb-*` skills. */
  syncSkills(): Promise<SkillSyncReport>;
  /** Gates implemented in this slice, for the gate runner's registry. */
  createGates(): Gate[];
  reload(): Promise<PackLoadResult>;
}

const EMPTY_SYNC: SkillSyncReport = { installed: [], removed: [], unchanged: [], errors: [] };

export function createPacksService(deps: PacksServiceDeps): PacksService {
  let loading: Promise<PackLoadResult> | null = null;
  let syncing: Promise<unknown> = Promise.resolve();
  const warn = deps.onWarning ?? (() => undefined);

  const load = (): Promise<PackLoadResult> => {
    loading ??= loadPacks({
      bundled: deps.bundled ?? defaultBundledPacks,
      userPacksDir: deps.userPacksDir,
      fs: deps.fs,
      knownGateIds: KNOWN_GATE_IDS,
    });
    return loading;
  };

  async function summarize(pack: LoadedPack, enabled: boolean): Promise<PackSummary> {
    const { manifest } = pack;
    const secrets = await Promise.all(
      manifest.requiredSecrets.map(async (secret) => ({
        ...secret,
        present: (await deps.secrets.resolve(secret.name).catch(() => undefined)) !== undefined,
        location: deps.secrets.describeLocation(secret.name),
      }))
    );
    return {
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      license: manifest.license,
      source: pack.source,
      enabled,
      roles: manifest.roles.map(({ id, title, kind }) => ({ id, title, kind })),
      mcpServers: manifest.mcpServers.map((s) => ({
        name: s.name,
        description: s.description,
        license: s.license,
        optional: s.optional,
        homepage: s.homepage,
        transport: s.transport,
      })),
      catalogLinks: manifest.catalogLinks ?? [],
      skills: manifest.skills.map((s) => ({
        id: s.id,
        installId: packSkillInstallId(manifest.id, s.id),
        source: s.source,
      })),
      gates: manifest.gates,
      secrets,
    };
  }

  async function enabledAnywhere(): Promise<Set<string>> {
    const projects = await deps.prefs.listProjects();
    const lists = await Promise.all(projects.map((id) => deps.prefs.getEnabled(id)));
    return new Set(lists.flat());
  }

  const syncSkills = (): Promise<SkillSyncReport> => {
    const skills = deps.skills;
    if (!skills) return Promise.resolve(EMPTY_SYNC);
    const run = syncing.then(async () => {
      const { packs } = await load();
      return syncPackSkills(skills, desiredPackSkills(packs, await enabledAnywhere()));
    });
    syncing = run.catch(() => undefined);
    return run;
  };

  async function seoReviewerServers(): Promise<McpServerEntry[]> {
    const { packs } = await load();
    const seo = packs.filter((p) => p.manifest.id === 'seo');
    const launch = await resolvePackLaunch({
      packs: seo,
      enabledPackIds: ['seo'],
      secrets: deps.secrets,
    });
    return launch.mcpServers;
  }

  return {
    async list(projectId) {
      const [{ packs, errors }, enabled] = await Promise.all([
        load(),
        projectId ? deps.prefs.getEnabled(projectId) : Promise.resolve([]),
      ]);
      const on = new Set(enabled);
      return {
        packs: await Promise.all(packs.map((pack) => summarize(pack, on.has(pack.manifest.id)))),
        errors,
      };
    },

    async setEnabled(projectId, packId, enabled) {
      const { packs } = await load();
      if (!packs.some((p) => p.manifest.id === packId)) {
        return err({ type: 'unknown-pack', message: `No loaded pack has id "${packId}"` });
      }
      let enabledPackIds: string[];
      try {
        // Ids of packs that failed to load are kept, so a broken user pack keeps its toggle.
        const current = await deps.prefs.getEnabled(projectId);
        enabledPackIds = enabled
          ? [...new Set([...current, packId])]
          : current.filter((id) => id !== packId);
        await deps.prefs.setEnabled(projectId, enabledPackIds);
      } catch (error) {
        return err({ type: 'persistence', message: String(error) });
      }
      const report = await syncSkills().catch((error: unknown) => ({
        ...EMPTY_SYNC,
        errors: [String(error)],
      }));
      for (const message of report.errors) warn(`pack skill sync: ${message}`);
      return ok({ enabledPackIds });
    },

    async resolvePackLaunch(projectId, roleId) {
      const [{ packs }, enabledPackIds] = await Promise.all([
        load(),
        deps.prefs.getEnabled(projectId),
      ]);
      return resolvePackLaunch({ packs, enabledPackIds, roleId, secrets: deps.secrets });
    },

    syncSkills,

    createGates() {
      return [seoEvidenceGate({ resolveReviewerServers: seoReviewerServers })];
    },

    reload() {
      loading = null;
      return load();
    },
  };
}

/**
 * The service the controller manifest falls back to until the integrator
 * passes a configured one through the controller context: memento-backed
 * prefs and the upstream skills manager, but no secret store and no user packs.
 */
export function createFallbackPacksService(context: {
  runtimes: SkillsRuntimeBroker;
  getMementosRuntimeClient: () => Promise<PackPrefsMementoClient>;
}): PacksService {
  return createPacksService({
    prefs: createMementoPackPrefsStore(context.getMementosRuntimeClient),
    secrets: unconfiguredSecretResolver,
    skills: createRuntimeSkillsPort(context.runtimes),
  });
}

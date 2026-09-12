import type { Gate } from '@emdash/gates-core';
import { err, ok, type Result } from '@emdash/shared';
import type { SkillsRuntimeBroker } from '@core/features/skills/api/runtime-adapter';
import { USER_PACKS_ENABLED } from '@core/primitives/app-identity/api/fork-flags';
import type { PacksError, PacksListing, PackSummary } from '../api/contract';
import type { McpServerEntry, PackLaunch } from '../api/launch';
import { normalizeBaseUrl } from '../api/pack-schema';
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
import { unconfiguredSecretResolver, type PackSecretStore, type SecretResolver } from './secrets';
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
  /** Where Settings → Packs stores secrets (the keychain). Omit and set/clear refuse. */
  secretStore?: PackSecretStore;
  /** Omit to skip skill installation (tests, remote hosts). */
  skills?: SkillsPort;
  /** `<userData>/ninebrains/packs`. Ignored unless user packs are allowed (SEC-26). */
  userPacksDir?: string;
  /** Overrides the `USER_PACKS_ENABLED` fork flag (off in v0.1). For tests. */
  allowUserPacks?: boolean;
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
  /**
   * Stores a secret some loaded pack declares. Write-only: the value is never returned,
   * logged or put in an error, and `list` only reports whether it is set.
   */
  setSecret(name: string, value: string): Promise<Result<void, PacksError>>;
  clearSecret(name: string): Promise<Result<void, PacksError>>;
  /** Merged into a lane's launch config by the Phase-2 launch builder. */
  resolvePackLaunch(projectId: string, roleId?: string): Promise<PackLaunch>;
  /** Installs skills of packs enabled anywhere; removes stale `nb-*` skills. */
  syncSkills(): Promise<SkillSyncReport>;
  /** Gates implemented in this slice, for the gate runner's registry. */
  createGates(): Gate[];
  reload(): Promise<PackLoadResult>;
}

const EMPTY_SYNC: SkillSyncReport = { installed: [], removed: [], unchanged: [], errors: [] };

const NO_SECRET_STORE: PacksError = {
  type: 'secret-store',
  message: 'No secret store is configured in this build.',
};

export function createPacksService(deps: PacksServiceDeps): PacksService {
  let loading: Promise<PackLoadResult> | null = null;
  let syncing: Promise<unknown> = Promise.resolve();
  const warn = deps.onWarning ?? (() => undefined);

  const load = (): Promise<PackLoadResult> => {
    loading ??= loadPacks({
      bundled: deps.bundled ?? defaultBundledPacks,
      // SEC-26: user packs load only when the fork flag (or a test) turns them on.
      userPacksDir: (deps.allowUserPacks ?? USER_PACKS_ENABLED) ? deps.userPacksDir : undefined,
      fs: deps.fs,
      knownGateIds: KNOWN_GATE_IDS,
    });
    return loading;
  };

  async function summarize(pack: LoadedPack, enabled: boolean): Promise<PackSummary> {
    const { manifest } = pack;
    const resolve = (name: string) => deps.secrets.resolve(name).catch(() => undefined);
    const inStore = (name: string) => deps.secretStore?.has(name).catch(() => false) ?? false;
    const secrets = await Promise.all(
      manifest.requiredSecrets.map(async (secret) => ({
        ...secret,
        present: (await resolve(secret.name)) !== undefined,
        location: deps.secrets.describeLocation(secret.name),
        storedInApp: await inStore(secret.name),
      }))
    );
    const declared = manifest.settings ?? [];
    const settings = await Promise.all(
      declared.map(async (setting) => {
        const value = await resolve(setting.name);
        return {
          name: setting.name,
          description: setting.description,
          default: setting.default,
          location: deps.secrets.describeLocation(setting.name),
          overridden:
            value !== undefined && normalizeBaseUrl(value) !== normalizeBaseUrl(setting.default),
        };
      })
    );
    const disclosures = declared.flatMap((setting, i) =>
      setting.defaultDisclosure && !settings[i].overridden ? [setting.defaultDisclosure] : []
    );
    return {
      settings,
      disclosures,
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      license: manifest.license,
      source: pack.source,
      enabled,
      roles: manifest.roles.map(({ id, title, kind, provider, model }) => ({
        id,
        title,
        kind,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      })),
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

  /** Only names a loaded pack declares may be written, so the page is no keychain editor. */
  async function declaredSecret(name: string): Promise<Result<void, PacksError>> {
    const { packs } = await load();
    const declared = packs.some((pack) =>
      pack.manifest.requiredSecrets.some((secret) => secret.name === name)
    );
    return declared
      ? ok(undefined)
      : err({ type: 'unknown-secret', message: `No loaded pack declares a secret "${name}".` });
  }

  /**
   * The store's own message, first line only and with the value cut out wherever it appears: a
   * store or database error may quote its input (drizzle puts query params on a later line).
   * A thrown non-Error is not trusted at all.
   */
  function storeFailure(
    action: string,
    name: string,
    error: unknown,
    value?: string
  ): Result<never, PacksError> {
    let reason =
      error instanceof Error ? (error.message.split('\n')[0] ?? '') : 'the secret store failed';
    for (const needle of [value, value?.trim()]) {
      if (needle) reason = reason.replaceAll(needle, '[redacted]');
    }
    warn(`pack secret ${name}: ${action} failed: ${reason}`);
    return err({ type: 'secret-store', message: `Could not ${action} ${name}: ${reason}` });
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
    // Packs are off by default: no project enabled the SEO pack, so no SEO server (and no
    // token sent to a hosted endpoint), and the gate reports a configuration problem.
    if (!(await enabledAnywhere()).has('seo')) return [];
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

    async setSecret(name, value) {
      const store = deps.secretStore;
      if (!store) return err(NO_SECRET_STORE);
      const declared = await declaredSecret(name);
      if (!declared.success) return declared;
      const trimmed = value.trim();
      if (!trimmed) return err({ type: 'unknown-secret', message: `${name} cannot be empty.` });
      try {
        await store.set(name, trimmed);
      } catch (error) {
        return storeFailure('store', name, error, value);
      }
      return ok(undefined);
    },

    async clearSecret(name) {
      const store = deps.secretStore;
      if (!store) return err(NO_SECRET_STORE);
      const declared = await declaredSecret(name);
      if (!declared.success) return declared;
      try {
        await store.clear(name);
      } catch (error) {
        return storeFailure('clear', name, error);
      }
      return ok(undefined);
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

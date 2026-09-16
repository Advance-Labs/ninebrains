import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type {
  AgentCliStatusEntry,
  AgentRoleMode,
  ConnectionTest,
  ProfilesListing,
  RoutingError,
} from '../api/contract';
import type { LaunchRouting, ProfileLaunch } from '../api/node/launch-env';
import {
  DEFERRED_KINDS,
  isPriced,
  isUnsupportedProfile,
  modelProfileInputSchema,
  profileKeySchema,
  protocolOfKind,
  UNPRICED,
  type ModelProfile,
  type ModelProfileInput,
  type ModelProfileView,
} from '../api/profile';
import type { ProfileKeyStore } from './keys';
import {
  resolveRoute,
  reviewerProfileStatus,
  type RouteDecision,
  type RoutingRole,
} from './policy';
import { createMemoryProfilesRepo, type ProfilesRepo, type StoredProfile } from './profiles-repo';
import type { ConnectionTester } from './test-connection';
import { VENDORS, vendorProblem } from './vendors';

const AGENT_CLI_PROVIDERS = ['claude', 'codex'] as const;
type AgentCliProvider = (typeof AGENT_CLI_PROVIDERS)[number];
const AGENT_CLI_ROLES: readonly RoutingRole[] = ['worker', 'subagent', 'reviewer'];

/** A lane as routing sees it. */
export interface RoutingLane {
  laneId: string;
  provider: 'claude' | 'codex';
  subagentModel?: string;
  authProfileId?: string;
}

export interface RoutingService {
  listProfiles(): Promise<ProfilesListing>;
  saveProfile(input: ModelProfileInput): Promise<Result<{ profileId: string }, RoutingError>>;
  setProfileKey(profileId: string, key: string): Promise<Result<void, RoutingError>>;
  clearProfileKey(profileId: string): Promise<Result<void, RoutingError>>;
  deleteProfile(profileId: string): Promise<Result<void, RoutingError>>;
  testConnection(profileId: string): Promise<Result<ConnectionTest, RoutingError>>;
  /**
   * A lane's route for one launch. For a profile, decrypts its key (SEC-40). Throws when the
   * profile is missing, disabled, keyless or off the vendor list, or profiles are off, so a lane
   * never falls back to the subscription.
   */
  prepareLaunch(lane: RoutingLane): Promise<LaunchRouting>;
  /**
   * A pinned reviewer profile's route (SEC-42). `profileId` is the app's `ninebrains.routing`
   * setting, read by the caller (`reviewer-route.ts`, wired in `create-ninebrains-services.ts`);
   * this method never reads it itself. Rejects, rather than falling back, once the profile is
   * missing, disabled, keyless or unhealthy — a reviewer pin is never silently downgraded.
   */
  prepareReviewerRoute(profileId: string): Promise<LaunchRouting>;
  /**
   * Read-only visibility, no new spawn: which CLIs are installed, and which auth mode each role
   * (worker/subagent/reviewer) will actually run under today. Never reads a credential file (D5).
   */
  agentCliStatus(): Promise<AgentCliStatusEntry[]>;
}

export interface RoutingServiceDeps {
  /**
   * The live `ninebrains.routing.profilesEnabled` app setting (T47), read fresh on every call —
   * never cached at service construction, so a toggle in Settings → Models takes effect on the
   * next call, not the next restart. Off: no profile can be listed, written, tested or launched.
   */
  enabled(): boolean | Promise<boolean>;
  profiles: ProfilesRepo;
  keys: ProfileKeyStore;
  testConnection: ConnectionTester;
  newId?: () => string;
  now?: () => number;
  onError(context: string, error: unknown): void;
  /**
   * Whether the given CLI is on this machine, and where — the same dependency-resolver call
   * `create-ninebrains-services.ts` already makes for the reviewer's `installed` set. No new
   * probing mechanism, and never touches a credential file (D5).
   */
  resolveInstalled(
    provider: AgentCliProvider
  ): Promise<{ installed: boolean; path: string | null }>;
  /**
   * The pinned reviewer profile id, or null — the exact same closure `create-ninebrains-services.ts`
   * passes to `routeReviewer` (`reviewer-route.ts`), reused rather than a second read path, so
   * `agentCliStatus`'s reviewer row and an actual review can never disagree about what "the pin"
   * is. That closure already folds `profilesEnabled()` in (null while profiles are off), so
   * `agentCliStatus` does not gate this call itself.
   */
  reviewerProfileId(): Promise<string | null>;
}

const DISABLED: RoutingError = {
  type: 'disabled',
  message: 'Model profiles are off in this build. Lanes run on your own subscription login.',
};

const notFound = (profileId: string): RoutingError => ({
  type: 'not-found',
  message: `There is no model profile "${profileId}".`,
});

function toView(profile: StoredProfile): ModelProfileView {
  return {
    ...profile,
    unsupported: isUnsupportedProfile(profile),
    priced: isPriced(profile.price),
  };
}

export function toProfileLaunch(profile: ModelProfile): ProfileLaunch {
  return {
    id: profile.id,
    kind: profile.kind,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    ...(profile.model ? { model: profile.model } : {}),
    tierModels: profile.tierModels,
  };
}

/** `RouteDecision` -> the plain-words mode the wire contract carries (SEC-42's reason included verbatim). */
function decisionToMode(decision: RouteDecision, profiles: readonly ModelProfile[]): AgentRoleMode {
  switch (decision.status) {
    case 'subscription':
      return { kind: 'subscription' };
    case 'blocked':
      return { kind: 'blocked', reason: decision.reason };
    case 'profile': {
      const profile = profiles.find((p) => p.id === decision.profileId);
      // resolveRoute only ever returns an id it found in the same `profiles` list.
      return {
        kind: 'profile',
        profileLabel: profile?.label ?? decision.profileId,
        tier: profile?.tier ?? '',
      };
    }
  }
}

/**
 * The reviewer role's mode, mirroring `routeReviewer` exactly (not `resolveRoute(role, {
 * profiles })` the way worker/subagent do — a reviewer's route depends on the pin, which is not
 * "the strong tier" the way a worker's tier default is). `pin` is the same value `routeReviewer`
 * reads; `reviewerProfileStatus` is the same predicate `prepareReviewerRoute` checks before it
 * reveals a key, so this can report `blocked` without ever touching `deps.keys` (T46/T47's fix).
 */
function reviewerRoleMode(pin: string | null, profiles: readonly StoredProfile[]): AgentRoleMode {
  if (!pin) return { kind: 'subscription' };
  const status = reviewerProfileStatus(pin, profiles);
  return status.ok
    ? { kind: 'profile', profileLabel: status.profile.label, tier: status.profile.tier }
    : { kind: 'blocked', reason: status.reason };
}

export function createRoutingService(deps: RoutingServiceDeps): RoutingService {
  const newId = deps.newId ?? (() => randomUUID());
  const now = deps.now ?? (() => Date.now());

  /** The keychain's own message names no value. A thrown non-Error is not trusted. */
  function storeFailure(action: string, error: unknown): Result<never, RoutingError> {
    const reason = error instanceof Error ? error.message : 'the keychain failed';
    deps.onError(`routing: ${action} failed`, new Error(reason));
    return err({ type: 'secret-store', message: `Could not ${action}: ${reason}` });
  }

  function attempt<T>(context: string, fn: () => T): Result<T, RoutingError> {
    try {
      return ok(fn());
    } catch (error) {
      deps.onError(`routing: ${context} failed`, error);
      return err({ type: 'persistence', message: 'The model profile could not be saved.' });
    }
  }

  return {
    async listProfiles() {
      if (!(await deps.enabled())) return { enabled: false, profiles: [], vendors: [] };
      return { enabled: true, profiles: deps.profiles.list().map(toView), vendors: [...VENDORS] };
    },

    async saveProfile(raw) {
      if (!(await deps.enabled())) return err(DISABLED);
      const parsed = modelProfileInputSchema.safeParse(raw);
      if (!parsed.success) {
        return err({
          type: 'invalid',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const input = parsed.data;
      if (DEFERRED_KINDS.includes(input.kind)) {
        return err({ type: 'invalid', message: `${input.kind} profiles come in a later version.` });
      }
      const at = now();
      const fields = {
        label: input.label,
        kind: input.kind,
        vendorId: input.vendorId ?? null,
        protocol: protocolOfKind(input.kind) ?? input.protocol!,
        baseUrl: input.baseUrl,
        ...(input.model ? { model: input.model } : {}),
        tierModels: input.tierModels ?? {},
        tier: input.tier,
        price: input.price ?? UNPRICED,
        contextWindow: input.contextWindow ?? null,
        enabled: input.enabled,
      };
      const problem = vendorProblem(fields);
      if (problem) return err({ type: 'invalid', message: `This profile ${problem}.` });
      if (input.id) {
        const existing = deps.profiles.get(input.id);
        if (!existing) return err(notFound(input.id));
        const id = input.id;
        const updated = attempt('update', () =>
          deps.profiles.update({ ...fields, id, createdAt: existing.createdAt, updatedAt: at })
        );
        return updated.success ? ok({ profileId: id }) : updated;
      }
      const id = newId();
      const inserted = attempt('insert', () =>
        deps.profiles.insert({ ...fields, id, hasKey: false, createdAt: at, updatedAt: at })
      );
      return inserted.success ? ok({ profileId: id }) : inserted;
    },

    async setProfileKey(profileId, key) {
      if (!(await deps.enabled())) return err(DISABLED);
      if (!deps.profiles.get(profileId)) return err(notFound(profileId));
      if (!profileKeySchema.safeParse(key).success) {
        return err({ type: 'invalid', message: 'That does not look like an API key.' });
      }
      try {
        await deps.keys.set(profileId, key);
      } catch (error) {
        return storeFailure('store the key', error);
      }
      return attempt('key flag', () => deps.profiles.setHasKey(profileId, true, now()));
    },

    async clearProfileKey(profileId) {
      if (!(await deps.enabled())) return err(DISABLED);
      if (!deps.profiles.get(profileId)) return err(notFound(profileId));
      try {
        await deps.keys.clear(profileId);
      } catch (error) {
        return storeFailure('remove the key', error);
      }
      return attempt('key flag', () => deps.profiles.setHasKey(profileId, false, now()));
    },

    async deleteProfile(profileId) {
      if (!(await deps.enabled())) return err(DISABLED);
      if (!deps.profiles.get(profileId)) return err(notFound(profileId));
      try {
        await deps.keys.clear(profileId);
      } catch (error) {
        return storeFailure('remove the key', error);
      }
      return attempt('delete', () => deps.profiles.delete(profileId));
    },

    async testConnection(profileId) {
      if (!(await deps.enabled())) return err(DISABLED);
      const profile = deps.profiles.get(profileId);
      if (!profile) return err(notFound(profileId));
      let key: string | undefined;
      try {
        key = profile.hasKey ? await deps.keys.reveal(profileId) : undefined;
      } catch (error) {
        return storeFailure('read the key', error);
      }
      if (profile.kind !== 'local' && !key) {
        return err({ type: 'invalid', message: 'Add the API key first.' });
      }
      return ok(await deps.testConnection(toProfileLaunch(profile), key));
    },

    async prepareLaunch(lane) {
      const base = lane.subagentModel ? { subagentModel: lane.subagentModel } : {};
      if (!lane.authProfileId) return { auth: { mode: 'subscription' }, ...base };
      if (!(await deps.enabled())) throw new Error(DISABLED.message);
      const profile = deps.profiles.get(lane.authProfileId);
      if (!profile) {
        throw new Error(`The lane's model profile "${lane.authProfileId}" no longer exists.`);
      }
      if (!profile.enabled) throw new Error(`Model profile "${profile.label}" is turned off.`);
      const key = profile.hasKey ? await deps.keys.reveal(profile.id) : undefined;
      if (profile.kind !== 'local' && !key) {
        throw new Error(
          `Model profile "${profile.label}" has no API key. Add it in Settings → Models.`
        );
      }
      return {
        auth: { mode: 'profile', profile: toProfileLaunch(profile), ...(key ? { key } : {}) },
        ...base,
      };
    },

    async prepareReviewerRoute(profileId) {
      if (!(await deps.enabled())) throw new Error(DISABLED.message);
      const status = reviewerProfileStatus(profileId, deps.profiles.list());
      if (!status.ok) throw new Error(`The reviewer is blocked: ${status.reason}.`);
      const profile = status.profile;
      // `status.ok` already means hasKey || kind === 'local'; this only re-checks the actual
      // reveal in case the key flag and the keychain ever disagree (defense in depth).
      const key = profile.hasKey ? await deps.keys.reveal(profile.id) : undefined;
      if (profile.kind !== 'local' && !key) {
        throw new Error(
          `The reviewer is blocked: model profile "${profile.label}" has no API key. Add it in Settings → Models.`
        );
      }
      return {
        auth: { mode: 'profile', profile: toProfileLaunch(profile), ...(key ? { key } : {}) },
      };
    },

    async agentCliStatus() {
      // Off in this build: every role reads as the subscription, same rule as listProfiles —
      // profiles are ignored entirely, never partially applied.
      const profiles = (await deps.enabled()) ? deps.profiles.list() : [];
      // The exact pin `routeReviewer` reads (the shared closure `create-ninebrains-services.ts`
      // passes to both), which already folds `profilesEnabled()` in — null while profiles are
      // off — so nothing here needs to gate this call a second time (one read, one rule).
      const reviewerPin = await deps.reviewerProfileId();
      const results = await Promise.all(
        AGENT_CLI_PROVIDERS.map(async (provider) => {
          const { installed, path } = await deps.resolveInstalled(provider);
          // Routing roles are not provider-scoped today: `resolveRoute` never checks a profile's
          // kind against `provider`, so worker/subagent mode is identical for `claude` and
          // `codex` here — mirroring resolveRoute's existing behavior, not a new gap. Worker and
          // subagent report the tier default a lane gets when it names no profile of its own
          // (`resolveRoute` with no explicit id); a lane that does name one runs under
          // `prepareLaunch(lane)` instead, which this panel does not read per lane (README,
          // "Agent CLI status"). The reviewer role is different: there is one pin, not a tier
          // scan, so it goes through `reviewerRoleMode`, not `resolveRoute` directly.
          const roles = AGENT_CLI_ROLES.map((role) => ({
            role,
            mode:
              role === 'reviewer'
                ? reviewerRoleMode(reviewerPin, profiles)
                : decisionToMode(resolveRoute(role, { profiles }), profiles),
          }));
          return { provider, installed, path, roles };
        })
      );
      return results;
    },
  };
}

/** The controller's fallback when the composition root passes no service. */
export function createDisabledRoutingService(): RoutingService {
  return createRoutingService({
    enabled: () => false,
    profiles: createMemoryProfilesRepo(),
    keys: {
      set: async () => Promise.reject(new Error(DISABLED.message)),
      reveal: async () => undefined,
      clear: async () => undefined,
    },
    testConnection: async () => ({
      status: 'error',
      message: DISABLED.message,
      httpStatus: null,
      modelCount: null,
    }),
    onError: () => {},
    resolveInstalled: async () => ({ installed: false, path: null }),
    reviewerProfileId: async () => null,
  });
}

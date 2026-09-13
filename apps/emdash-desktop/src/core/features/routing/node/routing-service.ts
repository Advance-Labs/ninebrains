import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { ConnectionTest, ProfilesListing, RoutingError } from '../api/contract';
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
import { createMemoryProfilesRepo, type ProfilesRepo, type StoredProfile } from './profiles-repo';
import type { ConnectionTester } from './test-connection';
import { VENDORS, vendorProblem } from './vendors';

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
}

export interface RoutingServiceDeps {
  /** `MODEL_PROFILES_ENABLED`. Off: no profile can be listed, written, tested or launched. */
  enabled: boolean;
  profiles: ProfilesRepo;
  keys: ProfileKeyStore;
  testConnection: ConnectionTester;
  newId?: () => string;
  now?: () => number;
  onError(context: string, error: unknown): void;
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
      if (!deps.enabled) return { enabled: false, profiles: [], vendors: [] };
      return { enabled: true, profiles: deps.profiles.list().map(toView), vendors: [...VENDORS] };
    },

    async saveProfile(raw) {
      if (!deps.enabled) return err(DISABLED);
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
      if (!deps.enabled) return err(DISABLED);
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
      if (!deps.enabled) return err(DISABLED);
      if (!deps.profiles.get(profileId)) return err(notFound(profileId));
      try {
        await deps.keys.clear(profileId);
      } catch (error) {
        return storeFailure('remove the key', error);
      }
      return attempt('key flag', () => deps.profiles.setHasKey(profileId, false, now()));
    },

    async deleteProfile(profileId) {
      if (!deps.enabled) return err(DISABLED);
      if (!deps.profiles.get(profileId)) return err(notFound(profileId));
      try {
        await deps.keys.clear(profileId);
      } catch (error) {
        return storeFailure('remove the key', error);
      }
      return attempt('delete', () => deps.profiles.delete(profileId));
    },

    async testConnection(profileId) {
      if (!deps.enabled) return err(DISABLED);
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
      if (!deps.enabled) throw new Error(DISABLED.message);
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
  };
}

/** The controller's fallback when the composition root passes no service. */
export function createDisabledRoutingService(): RoutingService {
  return createRoutingService({
    enabled: false,
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
  });
}

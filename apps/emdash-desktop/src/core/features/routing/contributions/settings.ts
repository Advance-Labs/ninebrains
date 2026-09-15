import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';
import { profileIdSchema } from '../api/profile';

export const ROUTING_SETTINGS_KEY = 'ninebrains.routing' as const;

export const routingSettingsSchema = z.object({
  /**
   * Lever B's real on/off switch (T47, `docs/plans/2026-09-15-routing-usability.md`), replacing
   * the old build-time `MODEL_PROFILES_ENABLED` flag. Default `false`: with this off, every
   * `RoutingService` method behaves exactly as it did when the flag was off (no profile can be
   * listed, written, tested or launched; `agentCliStatus` reports every role as the subscription;
   * a stored `reviewerProfileId` below has no effect, whatever it holds). Turning it on by itself
   * changes nothing further — a lane or reviewer still runs on the subscription until a profile is
   * actually added and attached. The user flips this deliberately in Settings → Models; it is
   * never read from an environment variable or a project/job/worktree file. SEC-08: reachable only
   * through the app-settings wire controller (`manifests/node/controllers.ts`), which has no
   * counterpart in brain-core's `BrainOp` vocabulary, so no lane or Brain token can flip it.
   */
  profilesEnabled: z.boolean(),
  /**
   * The one model profile reviewer runs are pinned to (SEC-42, plan §9.5, decided 2026-09-15).
   * Null: reviewers run on the user's subscription login, exactly as before this setting existed
   * — no setup needed. Once set, a reviewer run is pinned to this profile and blocks (never a
   * pass, never the subscription, never a lower tier) if it becomes missing, disabled, keyless or
   * unhealthy. Ignored while `profilesEnabled` above is off: reviewers always run on the
   * subscription then, whatever this holds.
   */
  reviewerProfileId: profileIdSchema.nullable(),
});

export type RoutingSettings = z.infer<typeof routingSettingsSchema>;

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  profilesEnabled: false,
  reviewerProfileId: null,
};

export const routingSettingsContribution = defineSettingsContribution<
  typeof ROUTING_SETTINGS_KEY,
  RoutingSettings
>({
  key: ROUTING_SETTINGS_KEY,
  schema: routingSettingsSchema,
  defaults: DEFAULT_ROUTING_SETTINGS,
});

import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';
import { profileIdSchema } from '../api/profile';

export const ROUTING_SETTINGS_KEY = 'ninebrains.routing' as const;

export const routingSettingsSchema = z.object({
  /**
   * The one model profile reviewer runs are pinned to (SEC-42, plan §9.5, decided 2026-09-15).
   * Null: reviewers run on the user's subscription login, exactly as before this setting existed
   * — no setup needed. Once set, a reviewer run is pinned to this profile and blocks (never a
   * pass, never the subscription, never a lower tier) if it becomes missing, disabled, keyless or
   * unhealthy. Ignored in a release build (`MODEL_PROFILES_ENABLED` off): reviewers always run on
   * the subscription there, whatever this holds.
   */
  reviewerProfileId: profileIdSchema.nullable(),
});

export type RoutingSettings = z.infer<typeof routingSettingsSchema>;

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = { reviewerProfileId: null };

export const routingSettingsContribution = defineSettingsContribution<
  typeof ROUTING_SETTINGS_KEY,
  RoutingSettings
>({
  key: ROUTING_SETTINGS_KEY,
  schema: routingSettingsSchema,
  defaults: DEFAULT_ROUTING_SETTINGS,
});

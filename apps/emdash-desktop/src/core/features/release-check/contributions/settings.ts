import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

export const RELEASE_CHECK_SETTINGS_KEY = 'ninebrains.releaseCheck' as const;

export const releaseCheckSettingsSchema = z.object({
  /**
   * "Check for new versions": once shortly after startup and every 12 hours, one unauthenticated
   * GET to api.github.com for the latest release. Default `false`: SEC-38 promises no traffic on
   * first run that the user did not start, so a packaged build stays silent until the user turns
   * this on (or presses "Check now"). Reachable only through the app-settings wire controller.
   */
  autoCheck: z.boolean(),
  /** The release whose notice the user closed. A newer release shows the notice again. */
  dismissedVersion: z.string().max(64).nullable(),
});

export type ReleaseCheckSettings = z.infer<typeof releaseCheckSettingsSchema>;

export const DEFAULT_RELEASE_CHECK_SETTINGS: ReleaseCheckSettings = {
  autoCheck: false,
  dismissedVersion: null,
};

export const releaseCheckSettingsContribution = defineSettingsContribution<
  typeof RELEASE_CHECK_SETTINGS_KEY,
  ReleaseCheckSettings
>({
  key: RELEASE_CHECK_SETTINGS_KEY,
  schema: releaseCheckSettingsSchema,
  defaults: DEFAULT_RELEASE_CHECK_SETTINGS,
});

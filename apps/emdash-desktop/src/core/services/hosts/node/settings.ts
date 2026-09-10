import type { HostSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';
import { hostSettingsSchemaContribution } from '../contributions/settings';

// The schema is contributed from the shared contributions surface; the
// defaults read process.env, so the full contribution is assembled here and
// aggregated by the node settings manifest.
export const hostSettingsContribution = defineSettingsContribution<'remoteMachine', HostSettings>({
  ...hostSettingsSchemaContribution,
  // Ninebrains: Emdash's R2 bucket is not used. No workspace-server release is published yet, so
  // remote installs fail with artifact-download-failed until one is, or until
  // EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL points at a mirror we own.
  defaults: () => ({
    installBaseUrl:
      process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'] ??
      'https://github.com/Advance-Labs/ninebrains/releases/download/workspace-server',
  }),
});

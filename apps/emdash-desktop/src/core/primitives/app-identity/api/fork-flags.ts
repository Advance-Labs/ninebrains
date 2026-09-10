/**
 * Ninebrains fork switches for Emdash features that need Emdash-hosted infrastructure. Each one
 * stays off until Ninebrains runs its own service for it. Every use is listed in
 * docs/UPSTREAM-PATCHES.md. Typed as `boolean` so type-aware lint does not treat the guarded
 * code as dead.
 */

/** Auto-update from Advance-Labs/ninebrains GitHub Releases. Off until the first release exists. */
export const UPDATES_ENABLED: boolean = false;

/** Emdash account sign-in against Emdash's auth server. Ninebrains has no account server. */
export const HOSTED_ACCOUNT_ENABLED: boolean = false;

/** Usage telemetry settings. No telemetry endpoint is configured, so there is nothing to toggle. */
export const TELEMETRY_SETTINGS_ENABLED: boolean = false;

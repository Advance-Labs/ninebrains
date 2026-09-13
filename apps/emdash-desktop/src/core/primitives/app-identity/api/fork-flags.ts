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

/**
 * SEC-26: v0.1 loads bundled discipline packs only. User packs from
 * `<userData>/ninebrains/packs` stay off until pinned installs with integrity
 * checks exist (docs/THREAT-MODEL.md, T20).
 */
export const USER_PACKS_ENABLED: boolean = false;

/**
 * Lever B of model routing (docs/plans/2026-09-12-model-routing.md): model profiles with the
 * user's own API keys, Settings → Models' profile list, and the API-key lane mode. On in dev
 * builds, off in release builds until Lucas decides (plan §8 Q1). Lever A (the subagent tier)
 * is always on.
 */
export const MODEL_PROFILES_ENABLED: boolean = import.meta.env.DEV;

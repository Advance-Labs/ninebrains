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
 * user's own API keys, Settings → Models' profile list, and the API-key lane mode. Lever A (the
 * subagent tier) is always on.
 *
 * Was `import.meta.env.DEV` (a build-time hold-back) until 2026-09-15: with SEC-39 through SEC-45
 * enforced and independently reviewed and the reviewer pin shipped (PR #4, T40), there is no
 * remaining reason to compile the feature out of release builds. This flag now just marks "the
 * code ships in this build" and stays `true` everywhere; the real on/off switch a user sees is
 * the `ninebrains.routing` app setting's `profilesEnabled` field (default `false`,
 * `docs/plans/2026-09-15-routing-usability.md`), which every call site below reads live, not at
 * boot. A user turns it on in Settings → Models; nothing changes until they also add a profile
 * (T47). SEC-08 still holds: that setting is reachable only through the app-settings wire
 * controller, which has no `BrainOp` counterpart, so no lane or Brain token can flip it.
 */
export const MODEL_PROFILES_ENABLED: boolean = true;

import type { ExecProvider } from '@core/features/exec-runs/api/node/types';
import type { ReviewerRoute } from '@core/features/gates/node/capabilities/spawn-reviewer';
import type { LaunchRouting } from '@core/features/routing/api/node/launch-env';

/**
 * Which CLI reviews a finished job, and which model route it runs on. `purpose` is the gate
 * asking: `'reviewer'`, `'security-review'`, or a pack gate's id (the SEO red-team, the
 * fact-checker). `deps.installed` holds the CLIs the host resolver found on this machine.
 *
 * Two rules pull against each other for the CLI choice:
 * - Independence (plan 4.3): a reviewer from a different provider than the worker
 *   catches what the worker's model is blind to. "Claude builds, Codex reviews."
 * - Containment (THREAT-MODEL R2, R13): Codex's sandbox restricts writes, not reads,
 *   and has no max-turns cap, so a Codex reviewer can read the home secrets that a
 *   Claude reviewer's settings deny, and it can run longer.
 *
 * The model route is a separate decision, decided (docs/plans/2026-09-12-model-routing.md §9.5,
 * 2026-09-15): the default stays the subscription; a user may pin reviewers to one model profile
 * in Settings → Models, and once pinned it is never downgraded (SEC-42) — missing, disabled,
 * keyless or unhealthy blocks the review rather than falling back to the subscription or a
 * cheaper tier. `deps.reviewerProfileId` and `deps.prepareReviewerRoute` come from
 * `create-ninebrains-services.ts`, which is the only place that reads the app's routing setting
 * and the profile store; this file stays a pure policy over what it is handed.
 */
export interface ReviewerRouteDeps {
  installed: ReadonlySet<ExecProvider>;
  /**
   * The pinned reviewer profile id, or null when none is set. Always null in a release build
   * (`MODEL_PROFILES_ENABLED` off): the caller is expected to fold that flag in here, so this
   * file never imports a build flag itself.
   */
  reviewerProfileId: () => Promise<string | null>;
  /**
   * Resolves a pinned profile id into its launch route. Rejects (SEC-42) when the profile is
   * missing, disabled, keyless or unhealthy — never resolves to the subscription or a lower tier.
   */
  prepareReviewerRoute: (profileId: string) => Promise<LaunchRouting>;
}

export async function routeReviewer(
  _purpose: string,
  deps: ReviewerRouteDeps
): Promise<ReviewerRoute> {
  // TODO(Lucas): the cross-provider independence rule. Claude-only (the contained choice) until
  // then; `deps.installed` is threaded through for when that lands.
  const provider: ExecProvider = 'claude';
  const profileId = await deps.reviewerProfileId();
  if (!profileId) return { provider };
  return { provider, routing: await deps.prepareReviewerRoute(profileId) };
}

import type { ExecProvider } from '@core/features/exec-runs/api/node/types';
import type { ReviewerRoute } from '@core/features/gates/node/capabilities/spawn-reviewer';

/**
 * Which CLI reviews a finished job. `purpose` is the gate asking: `'reviewer'`,
 * `'security-review'`, or a pack gate's id (the SEO red-team, the fact-checker).
 * `installed` holds the CLIs the host resolver found on this machine.
 *
 * Two rules pull against each other here:
 * - Independence (plan 4.3): a reviewer from a different provider than the worker
 *   catches what the worker's model is blind to. "Claude builds, Codex reviews."
 * - Containment (THREAT-MODEL R2, R13): Codex's sandbox restricts writes, not reads,
 *   and has no max-turns cap, so a Codex reviewer can read the home secrets that a
 *   Claude reviewer's settings deny, and it can run longer.
 */
export function routeReviewer(
  _purpose: string,
  _installed: ReadonlySet<ExecProvider>
): ReviewerRoute {
  // TODO(Lucas): the routing rule. Claude-only (the contained choice) until then.
  return { provider: 'claude' };
}

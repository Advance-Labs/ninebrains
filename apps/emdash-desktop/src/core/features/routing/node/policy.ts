/**
 * Routing policy (plan §4.4, R4): which tier a role runs at, and which profile satisfies it.
 *
 * `resolveRoute` picks a profile for one role once the caller has an explicit profile id (a
 * job's own choice, or none). Wave 2 does not yet wire a pack role's tier default or the
 * planner's per-job profile into that explicit id (README, "Deferred to wave 2") — this module
 * is the tier lookup and the SEC-42 pin those call sites will use once they exist.
 *
 * A worker or subagent role falls back to the user's own subscription login when no profile
 * matches its tier (plan §4.4: "If no profile exists for a tier, the run uses the user's own
 * login, as today"). A reviewer role never does (SEC-42): once a strong-tier profile is enabled,
 * review runs are pinned to it, and if every strong-tier profile becomes unavailable the review
 * is blocked, never silently run on a lower tier, a different profile or the subscription login.
 */
import type { ModelProfile, ProfileTier } from '../api/profile';

export type RoutingRole = 'worker' | 'subagent' | 'reviewer';

/** Plan §4.4 defaults. Project- and app-level overrides are the wave-2 follow-up above. */
export const ROLE_TIER: Readonly<Record<RoutingRole, ProfileTier>> = {
  worker: 'standard',
  subagent: 'cheap',
  reviewer: 'strong',
};

/**
 * A profile's health (R6's circuit breaker names these same three states). Optional: until R6
 * lands and starts recording state, an entry that is missing, or whose repo has none, reads as
 * healthy, so `resolveRoute` behaves exactly as it will once health tracking exists.
 */
export interface ProfileHealthState {
  profileId: string;
  state: 'closed' | 'open' | 'half_open';
}

export type RouteDecision =
  | { status: 'profile'; profileId: string }
  | { status: 'subscription' }
  | { status: 'blocked'; reason: string };

function isHealthy(profileId: string, health: readonly ProfileHealthState[]): boolean {
  // `open`: the breaker tripped and hasn't earned its probe back. Anything else is healthy.
  return health.find((h) => h.profileId === profileId)?.state !== 'open';
}

/** A reviewer blocks where a worker or subagent would fall back to the subscription (SEC-42). */
function fallbackOrBlocked(role: RoutingRole, reason: string): RouteDecision {
  return role === 'reviewer' ? { status: 'blocked', reason } : { status: 'subscription' };
}

export interface ResolveRouteInput {
  /** The job's or lane's own choice, ahead of the role's tier default (plan §4.4). */
  explicitProfileId?: string;
  profiles: readonly ModelProfile[];
  health?: readonly ProfileHealthState[];
}

/**
 * The job's explicit profile, else the role's tier default (the lowest profile id, for a
 * deterministic pick among ties), else the subscription — except a reviewer, which blocks
 * (SEC-42) rather than falling through past its `strong` tier.
 */
export function resolveRoute(role: RoutingRole, input: ResolveRouteInput): RouteDecision {
  const health = input.health ?? [];

  if (input.explicitProfileId !== undefined) {
    const profile = input.profiles.find((p) => p.id === input.explicitProfileId);
    if (!profile) {
      return fallbackOrBlocked(role, `model profile "${input.explicitProfileId}" no longer exists`);
    }
    if (!profile.enabled) {
      return fallbackOrBlocked(role, `model profile "${profile.label}" is turned off`);
    }
    if (!isHealthy(profile.id, health)) {
      return fallbackOrBlocked(role, `model profile "${profile.label}" is unavailable`);
    }
    return { status: 'profile', profileId: profile.id };
  }

  const tier = ROLE_TIER[role];
  const candidates = input.profiles
    .filter((p) => p.tier === tier && p.enabled)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return { status: 'subscription' };

  const healthy = candidates.find((p) => isHealthy(p.id, health));
  if (healthy) return { status: 'profile', profileId: healthy.id };

  // Every candidate for this tier exists but is unhealthy. A worker or subagent still has the
  // subscription to fall back to; a reviewer pinned to `strong` does not (SEC-42).
  return fallbackOrBlocked(role, `every ${tier}-tier model profile is unavailable`);
}

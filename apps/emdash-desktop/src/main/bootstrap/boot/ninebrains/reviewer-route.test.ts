import { describe, expect, it, vi } from 'vitest';
import type { LaunchRouting } from '@core/features/routing/api/node/launch-env';
import { routeReviewer, type ReviewerRouteDeps } from './reviewer-route';

const PROFILE_ROUTING: LaunchRouting = {
  auth: {
    mode: 'profile',
    profile: {
      id: 'strong-1',
      kind: 'anthropic-api',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    },
    key: 'sk-ant-mock',
  },
};

function deps(over: Partial<ReviewerRouteDeps> = {}): ReviewerRouteDeps {
  return {
    installed: new Set(['claude']),
    reviewerProfileId: async () => null,
    prepareReviewerRoute: vi.fn(async () => PROFILE_ROUTING),
    ...over,
  };
}

describe('routeReviewer (SEC-42)', () => {
  it('default: no pin configured, runs on the subscription exactly as before', async () => {
    const route = await routeReviewer('reviewer', deps());
    expect(route).toEqual({ provider: 'claude' });
  });

  it('a pinned profile is resolved and attached as `routing`', async () => {
    const prepareReviewerRoute = vi.fn(async () => PROFILE_ROUTING);
    const route = await routeReviewer(
      'reviewer',
      deps({ reviewerProfileId: async () => 'strong-1', prepareReviewerRoute })
    );
    expect(route).toEqual({ provider: 'claude', routing: PROFILE_ROUTING });
    expect(prepareReviewerRoute).toHaveBeenCalledWith('strong-1');
  });

  it('a blocked pin (missing, disabled, keyless or unhealthy) rejects rather than falling back', async () => {
    await expect(
      routeReviewer(
        'reviewer',
        deps({
          reviewerProfileId: async () => 'strong-1',
          prepareReviewerRoute: async () => {
            throw new Error('The reviewer is blocked: model profile "strong-1" is unavailable.');
          },
        })
      )
    ).rejects.toThrow(/reviewer is blocked/);
  });

  it('profiles off (T47): the caller folds `profilesEnabled` into `reviewerProfileId`, ignoring any stored pin', async () => {
    // The caller (create-ninebrains-services.ts) is expected to resolve to null when the live
    // `ninebrains.routing.profilesEnabled` setting is off; this file has no settings or build-flag
    // import of its own, so this is that contract.
    const prepareReviewerRoute = vi.fn(async () => PROFILE_ROUTING);
    const route = await routeReviewer(
      'reviewer',
      deps({ reviewerProfileId: async () => null, prepareReviewerRoute })
    );
    expect(route).toEqual({ provider: 'claude' });
    expect(prepareReviewerRoute).not.toHaveBeenCalled();
  });
});

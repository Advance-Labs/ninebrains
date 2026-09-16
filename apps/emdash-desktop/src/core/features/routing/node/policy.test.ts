import { describe, expect, it } from 'vitest';
import type { ModelProfile } from '../api/profile';
import { resolveRoute, reviewerProfileStatus, ROLE_TIER, type ProfileHealthState } from './policy';

const UNPRICED = {
  inPerMTok: null,
  outPerMTok: null,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
} as const;

function profile(overrides: Partial<ModelProfile> & { id: string }): ModelProfile {
  return {
    label: overrides.id,
    kind: 'anthropic-api',
    vendorId: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    tierModels: {},
    tier: 'standard',
    price: UNPRICED,
    contextWindow: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function keyedProfile(
  overrides: Partial<ModelProfile & { hasKey: boolean }> & { id: string }
): ModelProfile & { hasKey: boolean } {
  return { ...profile(overrides), hasKey: overrides.hasKey ?? true };
}

describe('resolveRoute: role tier defaults', () => {
  it('maps worker, subagent and reviewer to standard, cheap and strong', () => {
    expect(ROLE_TIER).toEqual({ worker: 'standard', subagent: 'cheap', reviewer: 'strong' });
  });

  it('falls back to the subscription when no profile matches the tier', () => {
    const decision = resolveRoute('worker', { profiles: [] });
    expect(decision).toEqual({ status: 'subscription' });
  });

  it('picks the enabled profile at the role tier, lowest id first among ties', () => {
    const profiles = [
      profile({ id: 'b-cheap', tier: 'cheap' }),
      profile({ id: 'a-cheap', tier: 'cheap' }),
      profile({ id: 'a-standard', tier: 'standard' }),
    ];
    expect(resolveRoute('subagent', { profiles })).toEqual({
      status: 'profile',
      profileId: 'a-cheap',
    });
  });

  it('ignores a disabled profile at the right tier', () => {
    const profiles = [profile({ id: 'p1', tier: 'cheap', enabled: false })];
    expect(resolveRoute('subagent', { profiles })).toEqual({ status: 'subscription' });
  });

  it('skips an open-circuit profile for one that is still healthy', () => {
    const profiles = [
      profile({ id: 'a-cheap', tier: 'cheap' }),
      profile({ id: 'b-cheap', tier: 'cheap' }),
    ];
    const health: ProfileHealthState[] = [{ profileId: 'a-cheap', state: 'open' }];
    expect(resolveRoute('subagent', { profiles, health })).toEqual({
      status: 'profile',
      profileId: 'b-cheap',
    });
  });
});

describe("resolveRoute: an explicit profile id (a job's own choice)", () => {
  it('is used ahead of the tier default', () => {
    const profiles = [
      profile({ id: 'the-cheap-one', tier: 'cheap' }),
      profile({ id: 'the-standard-one', tier: 'standard' }),
    ];
    expect(resolveRoute('worker', { profiles, explicitProfileId: 'the-cheap-one' })).toEqual({
      status: 'profile',
      profileId: 'the-cheap-one',
    });
  });

  it('falls back to the subscription for a worker whose explicit profile no longer exists', () => {
    const decision = resolveRoute('worker', { profiles: [], explicitProfileId: 'gone' });
    expect(decision).toEqual({ status: 'subscription' });
  });

  it('falls back to the subscription for a worker whose explicit profile is disabled', () => {
    const profiles = [profile({ id: 'p1', enabled: false })];
    const decision = resolveRoute('worker', { profiles, explicitProfileId: 'p1' });
    expect(decision).toEqual({ status: 'subscription' });
  });
});

describe('SEC-42 reviewers are never downgraded', () => {
  it('blocks, rather than falls back, when the explicit reviewer profile no longer exists', () => {
    const decision = resolveRoute('reviewer', { profiles: [], explicitProfileId: 'gone' });
    expect(decision).toEqual({
      status: 'blocked',
      reason: 'model profile "gone" no longer exists',
    });
  });

  it('blocks when the explicit reviewer profile is disabled', () => {
    const profiles = [
      profile({ id: 'p1', label: 'Strong reviewer', tier: 'strong', enabled: false }),
    ];
    const decision = resolveRoute('reviewer', { profiles, explicitProfileId: 'p1' });
    expect(decision).toEqual({
      status: 'blocked',
      reason: 'model profile "Strong reviewer" is turned off',
    });
  });

  it('blocks when the explicit reviewer profile has tripped its circuit breaker', () => {
    const profiles = [profile({ id: 'p1', label: 'Strong reviewer', tier: 'strong' })];
    const health: ProfileHealthState[] = [{ profileId: 'p1', state: 'open' }];
    const decision = resolveRoute('reviewer', { profiles, explicitProfileId: 'p1', health });
    expect(decision).toEqual({
      status: 'blocked',
      reason: 'model profile "Strong reviewer" is unavailable',
    });
  });

  it('picks a healthy strong-tier profile by tier default, same as any other role', () => {
    const profiles = [profile({ id: 'strong-1', tier: 'strong' })];
    expect(resolveRoute('reviewer', { profiles })).toEqual({
      status: 'profile',
      profileId: 'strong-1',
    });
  });

  it('has no strong-tier profile configured: stays on the subscription, as wave 1 does', () => {
    const profiles = [profile({ id: 'cheap-1', tier: 'cheap' })];
    expect(resolveRoute('reviewer', { profiles })).toEqual({ status: 'subscription' });
  });

  it('blocks, never falls back to a lower tier or the subscription, once every strong profile is unavailable', () => {
    const profiles = [
      profile({ id: 'strong-1', tier: 'strong' }),
      profile({ id: 'strong-2', tier: 'strong' }),
      profile({ id: 'cheap-1', tier: 'cheap' }),
    ];
    const health: ProfileHealthState[] = [
      { profileId: 'strong-1', state: 'open' },
      { profileId: 'strong-2', state: 'open' },
    ];
    const decision = resolveRoute('reviewer', { profiles, health });
    expect(decision).toEqual({
      status: 'blocked',
      reason: 'every strong-tier model profile is unavailable',
    });
  });
});

describe('reviewerProfileStatus: the non-revealing predicate T46 factored out', () => {
  it('is ok for a pinned, enabled, keyed profile', () => {
    const profiles = [keyedProfile({ id: 'p1', label: 'Strong reviewer', tier: 'strong' })];
    const status = reviewerProfileStatus('p1', profiles);
    expect(status).toEqual({ ok: true, profile: profiles[0] });
  });

  it('is ok for a local profile with no key: local needs none', () => {
    const profiles = [
      keyedProfile({ id: 'p1', kind: 'local', protocol: 'anthropic', hasKey: false }),
    ];
    expect(reviewerProfileStatus('p1', profiles)).toEqual({ ok: true, profile: profiles[0] });
  });

  it('blocks a pinned profile with no key, the check resolveRoute alone cannot make', () => {
    const profiles = [
      keyedProfile({ id: 'p1', label: 'Strong reviewer', tier: 'strong', hasKey: false }),
    ];
    expect(reviewerProfileStatus('p1', profiles)).toEqual({
      ok: false,
      reason: 'model profile "Strong reviewer" has no API key',
    });
  });

  it('blocks a missing pin, same reason resolveRoute already gives', () => {
    expect(reviewerProfileStatus('ghost', [])).toEqual({
      ok: false,
      reason: 'model profile "ghost" no longer exists',
    });
  });

  it('blocks a disabled pin, same reason resolveRoute already gives', () => {
    const profiles = [
      keyedProfile({ id: 'p1', label: 'Strong reviewer', tier: 'strong', enabled: false }),
    ];
    expect(reviewerProfileStatus('p1', profiles)).toEqual({
      ok: false,
      reason: 'model profile "Strong reviewer" is turned off',
    });
  });

  it('blocks an unhealthy pin, same reason resolveRoute already gives', () => {
    const profiles = [keyedProfile({ id: 'p1', label: 'Strong reviewer', tier: 'strong' })];
    const health: ProfileHealthState[] = [{ profileId: 'p1', state: 'open' }];
    expect(reviewerProfileStatus('p1', profiles, health)).toEqual({
      ok: false,
      reason: 'model profile "Strong reviewer" is unavailable',
    });
  });

  it('never reads a key field beyond the hasKey flag: the profile object passed in is returned untouched', () => {
    const profiles = [keyedProfile({ id: 'p1', tier: 'strong' })];
    const status = reviewerProfileStatus('p1', profiles);
    expect(status.ok && status.profile).toBe(profiles[0]);
  });
});

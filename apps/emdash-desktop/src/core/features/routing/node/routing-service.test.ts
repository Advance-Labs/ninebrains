import { describe, expect, it, vi } from 'vitest';
import { createRedactor } from '@core/features/exec-runs/api/node/redact';
import type { ModelProfileInput } from '../api/profile';
import { createProfileKeyStore, type ProfileKeySink } from './keys';
import { createMemoryProfilesRepo } from './profiles-repo';
import { createRoutingService, type RoutingServiceDeps } from './routing-service';
import type { ConnectionTester } from './test-connection';

function fakeSink(): ProfileKeySink & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getSecret: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : { expose: () => value };
    }),
    setSecret: vi.fn(async (key: string, value: { expose(): string }) => {
      store.set(key, value.expose());
    }),
    deleteSecret: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const NOOP_TESTER: ConnectionTester = async () => ({
  status: 'ok',
  httpStatus: 200,
  message: 'Connected.',
  modelCount: 0,
});

const INSTALLED_EVERYWHERE = async () => ({ installed: true, path: '/usr/local/bin/mock' });

function harness(overrides: Partial<RoutingServiceDeps> = {}) {
  const repo = createMemoryProfilesRepo();
  const sink = fakeSink();
  const keys = createProfileKeyStore(sink);
  const onError = vi.fn();
  const service = createRoutingService({
    enabled: () => true,
    profiles: repo,
    keys,
    testConnection: NOOP_TESTER,
    onError,
    now: () => 1_000,
    newId: (() => {
      let n = 0;
      return () => `profile-${++n}`;
    })(),
    resolveInstalled: INSTALLED_EVERYWHERE,
    reviewerProfileId: async () => null,
    ...overrides,
  });
  return { repo, sink, keys, service, onError };
}

const ANTHROPIC_INPUT: ModelProfileInput = {
  label: 'Anthropic key',
  kind: 'anthropic-api',
  vendorId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
};

const LOCAL_INPUT: ModelProfileInput = {
  label: 'Local server',
  kind: 'local',
  protocol: 'anthropic',
  baseUrl: 'http://127.0.0.1:11434',
};

const CHEAP_INPUT: ModelProfileInput = {
  label: 'OpenRouter cheap',
  kind: 'anthropic-compatible',
  vendorId: 'openrouter',
  baseUrl: 'https://openrouter.ai/api',
  tier: 'cheap',
};

const KEY = 'sk-ant-donotleakthisvalue999888777';

describe('SEC-40 keys are write-only', () => {
  it('stores the key under ninebrains.model.<id>', async () => {
    const { service, sink } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    expect(sink.setSecret).toHaveBeenCalledWith(
      `ninebrains.model.${saved.data.profileId}`,
      expect.anything()
    );
    expect(sink.store.get(`ninebrains.model.${saved.data.profileId}`)).toBe(KEY);
  });

  it('never exposes the key through listProfiles, only hasKey', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    const listing = await service.listProfiles();
    const serialized = JSON.stringify(listing);
    expect(serialized).not.toContain(KEY);
    const profile = listing.profiles.find((p) => p.id === saved.data.profileId);
    expect(profile?.hasKey).toBe(true);
  });

  it('yields a secret-store error whose message does not contain the key when the sink throws', async () => {
    const { service, sink } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    vi.mocked(sink.setSecret).mockRejectedValueOnce(new Error('disk full'));
    const result = await service.setProfileKey(saved.data.profileId, KEY);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('secret-store');
      expect(result.error.message).not.toContain(KEY);
    }
  });

  it('clears the keychain entry on deleteProfile', async () => {
    const { service, sink } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    const deleted = await service.deleteProfile(saved.data.profileId);
    expect(deleted.success).toBe(true);
    expect(sink.store.has(`ninebrains.model.${saved.data.profileId}`)).toBe(false);
  });

  it('prepareLaunch returns the key for a profile lane', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    const routing = await service.prepareLaunch({
      laneId: 'l1',
      provider: 'claude',
      authProfileId: saved.data.profileId,
    });
    expect(routing.auth).toMatchObject({ mode: 'profile', key: KEY });
  });

  it('prepareLaunch throws for a keyless api-key profile', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await expect(
      service.prepareLaunch({
        laneId: 'l1',
        provider: 'claude',
        authProfileId: saved.data.profileId,
      })
    ).rejects.toThrow(/no API key/);
  });

  it('prepareLaunch throws for a disabled profile', async () => {
    const { service } = harness();
    const saved = await service.saveProfile({ ...ANTHROPIC_INPUT, enabled: false });
    if (!saved.success) throw new Error(saved.error.message);
    await expect(
      service.prepareLaunch({
        laneId: 'l1',
        provider: 'claude',
        authProfileId: saved.data.profileId,
      })
    ).rejects.toThrow(/turned off/);
  });

  it('prepareLaunch throws for a missing profile', async () => {
    const { service } = harness();
    await expect(
      service.prepareLaunch({ laneId: 'l1', provider: 'claude', authProfileId: 'ghost' })
    ).rejects.toThrow(/no longer exists/);
  });

  it('prepareLaunch throws when profiles are disabled', async () => {
    const { service } = harness({ enabled: () => false });
    await expect(
      service.prepareLaunch({ laneId: 'l1', provider: 'claude', authProfileId: 'anything' })
    ).rejects.toThrow();
  });

  it('a lane with no authProfileId gets a subscription route plus its subagentModel', async () => {
    const { service } = harness();
    const routing = await service.prepareLaunch({
      laneId: 'l1',
      provider: 'claude',
      subagentModel: 'haiku',
    });
    expect(routing).toEqual({ auth: { mode: 'subscription' }, subagentModel: 'haiku' });
  });

  it('turns off every mutating call and empties list when the flag is off', async () => {
    const { service } = harness({ enabled: () => false });
    expect(await service.listProfiles()).toEqual({ enabled: false, profiles: [], vendors: [] });
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    expect(saved.success).toBe(false);
    if (!saved.success) expect(saved.error.type).toBe('disabled');
    const keyResult = await service.setProfileKey('any', KEY);
    expect(keyResult.success).toBe(false);
    if (!keyResult.success) expect(keyResult.error.type).toBe('disabled');
    const cleared = await service.clearProfileKey('any');
    expect(cleared.success).toBe(false);
    if (!cleared.success) expect(cleared.error.type).toBe('disabled');
    const deleted = await service.deleteProfile('any');
    expect(deleted.success).toBe(false);
    if (!deleted.success) expect(deleted.error.type).toBe('disabled');
    const tested = await service.testConnection('any');
    expect(tested.success).toBe(false);
    if (!tested.success) expect(tested.error.type).toBe('disabled');
  });
});

describe('SEC-44', () => {
  it('saveProfile with a host off the vendor allowlist returns invalid', async () => {
    const { service } = harness();
    const result = await service.saveProfile({
      label: 'Bad host',
      kind: 'anthropic-compatible',
      vendorId: 'openrouter',
      baseUrl: 'https://evil.test/api',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('invalid');
  });

  it('saveProfile with a bedrock kind returns invalid, naming a later version', async () => {
    const { service } = harness();
    const result = await service.saveProfile({
      label: 'Bedrock',
      kind: 'bedrock',
      vendorId: 'anthropic',
      baseUrl: 'https://bedrock.us-east-1.amazonaws.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid');
      expect(result.error.message).toMatch(/later version/);
    }
  });
});

describe('SEC-40 setProfileKey registers the redactor secret', () => {
  it('hides the key from a redactor created before the call', async () => {
    const { service } = harness();
    const redact = createRedactor();
    const saved = await service.saveProfile(LOCAL_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    expect(redact(`leaked ${KEY} right here`)).not.toContain(KEY);
  });
});

describe('SEC-42 prepareReviewerRoute: a reviewer pin is never silently downgraded', () => {
  it('a pinned, healthy, keyed profile routes the reviewer to it', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await service.setProfileKey(saved.data.profileId, KEY);
    const routing = await service.prepareReviewerRoute(saved.data.profileId);
    expect(routing.auth).toMatchObject({ mode: 'profile', key: KEY });
  });

  it('a local profile with no key still routes: the placeholder token is a launch-time concern', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(LOCAL_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    const routing = await service.prepareReviewerRoute(saved.data.profileId);
    expect(routing.auth).toMatchObject({ mode: 'profile' });
    expect((routing.auth as { key?: string }).key).toBeUndefined();
  });

  it('blocks, never falls back, when the pinned profile is missing', async () => {
    const { service } = harness();
    await expect(service.prepareReviewerRoute('ghost')).rejects.toThrow(
      /reviewer is blocked.*no longer exists/i
    );
  });

  it('blocks when the pinned profile is disabled', async () => {
    const { service } = harness();
    const saved = await service.saveProfile({ ...ANTHROPIC_INPUT, enabled: false });
    if (!saved.success) throw new Error(saved.error.message);
    await expect(service.prepareReviewerRoute(saved.data.profileId)).rejects.toThrow(
      /reviewer is blocked.*turned off/i
    );
  });

  it('blocks when the pinned profile has no API key', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    await expect(service.prepareReviewerRoute(saved.data.profileId)).rejects.toThrow(
      /reviewer is blocked.*no API key/i
    );
  });

  it('blocks rather than routes when profiles are off in this build', async () => {
    const { service } = harness({ enabled: () => false });
    await expect(service.prepareReviewerRoute('anything')).rejects.toThrow();
  });
});

describe('agentCliStatus', () => {
  it('both CLIs installed, no profiles: every role on both providers is the subscription', async () => {
    const { service } = harness();
    const status = await service.agentCliStatus();
    expect(status).toHaveLength(2);
    for (const entry of status) {
      expect(entry.installed).toBe(true);
      expect(entry.path).toBe('/usr/local/bin/mock');
      expect(entry.roles).toEqual([
        { role: 'worker', mode: { kind: 'subscription' } },
        { role: 'subagent', mode: { kind: 'subscription' } },
        { role: 'reviewer', mode: { kind: 'subscription' } },
      ]);
    }
    expect(status.map((e) => e.provider).sort()).toEqual(['claude', 'codex']);
  });

  it('a cheap-tier profile routes the subagent role there; worker and reviewer stay on the subscription', async () => {
    const { service } = harness();
    const saved = await service.saveProfile(CHEAP_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    const [claude] = await service.agentCliStatus();
    const subagent = claude.roles.find((r) => r.role === 'subagent');
    expect(subagent?.mode).toEqual({
      kind: 'profile',
      profileLabel: 'OpenRouter cheap',
      tier: 'cheap',
    });
    const worker = claude.roles.find((r) => r.role === 'worker');
    expect(worker?.mode).toEqual({ kind: 'subscription' });
    const reviewer = claude.roles.find((r) => r.role === 'reviewer');
    expect(reviewer?.mode).toEqual({ kind: 'subscription' });
  });

  it('a disabled cheap-tier profile falls back to the subscription (same resolveRoute semantics as policy.test.ts)', async () => {
    const { service } = harness();
    const saved = await service.saveProfile({ ...CHEAP_INPUT, enabled: false });
    if (!saved.success) throw new Error(saved.error.message);
    const [claude] = await service.agentCliStatus();
    const subagent = claude.roles.find((r) => r.role === 'subagent');
    expect(subagent?.mode).toEqual({ kind: 'subscription' });
  });

  it('MODEL_PROFILES_ENABLED off: every role reports subscription even with profiles configured', async () => {
    const { repo } = harness();
    // Seed a profile directly on the repo, bypassing saveProfile's `enabled` gate, so a
    // disabled build's `agentCliStatus` can be checked against a repo that already has one.
    repo.insert({
      id: 'p1',
      label: 'OpenRouter cheap',
      kind: 'anthropic-compatible',
      vendorId: 'openrouter',
      protocol: 'anthropic',
      baseUrl: 'https://openrouter.ai/api',
      tierModels: {},
      tier: 'cheap',
      price: { inPerMTok: null, outPerMTok: null, cacheReadPerMTok: null, cacheWritePerMTok: null },
      contextWindow: null,
      enabled: true,
      hasKey: false,
      createdAt: 0,
      updatedAt: 0,
    });
    const { service } = harness({ enabled: () => false, profiles: repo });
    const status = await service.agentCliStatus();
    for (const entry of status) {
      for (const { mode } of entry.roles) {
        expect(mode).toEqual({ kind: 'subscription' });
      }
    }
  });

  it('a CLI that is not installed still returns role info, independent of installed/path', async () => {
    const { service } = harness({
      resolveInstalled: async (provider) =>
        provider === 'codex'
          ? { installed: false, path: null }
          : { installed: true, path: '/bin/claude' },
    });
    const status = await service.agentCliStatus();
    const codex = status.find((e) => e.provider === 'codex')!;
    expect(codex.installed).toBe(false);
    expect(codex.path).toBeNull();
    expect(codex.roles).toHaveLength(3);
    expect(codex.roles.every((r) => r.mode.kind === 'subscription')).toBe(true);
  });

  describe('T46 fix: the reviewer row mirrors routeReviewer, not a tier scan', () => {
    /** A harness pinned to profile `p1` (or, with `enabled: false`, one whose pin is folded to
     * null the way `create-ninebrains-services.ts` does), with `keys.reveal` spied so every case
     * below can assert the panel's no-reveal property directly. */
    function pinnedHarness(options: { enabled?: boolean; pin?: string | null } = {}) {
      const repo = createMemoryProfilesRepo();
      const sink = fakeSink();
      const keys = createProfileKeyStore(sink);
      const revealSpy = vi.spyOn(keys, 'reveal');
      const service = createRoutingService({
        enabled: () => options.enabled ?? true,
        profiles: repo,
        keys,
        testConnection: NOOP_TESTER,
        onError: vi.fn(),
        resolveInstalled: INSTALLED_EVERYWHERE,
        newId: () => 'p1', // matches the pin below, so `saveProfile` creates exactly what's pinned
        reviewerProfileId: async () => (options.pin === undefined ? 'p1' : options.pin),
      });
      return { service, repo, revealSpy };
    }

    async function reviewerModeOf(service: ReturnType<typeof pinnedHarness>['service']) {
      const [claude] = await service.agentCliStatus();
      return claude.roles.find((r) => r.role === 'reviewer')!.mode;
    }

    it('unpinned reviewer reads as the subscription, even with a strong-tier profile enabled', async () => {
      const { service } = pinnedHarness({ pin: null });
      const saved = await service.saveProfile({ ...ANTHROPIC_INPUT, tier: 'strong' });
      if (!saved.success) throw new Error(saved.error.message);
      expect(await reviewerModeOf(service)).toEqual({ kind: 'subscription' });
    });

    it('a pinned, enabled, keyed profile routes the reviewer to it, without revealing the key', async () => {
      const { service, revealSpy } = pinnedHarness();
      const saved = await service.saveProfile(ANTHROPIC_INPUT);
      if (!saved.success) throw new Error(saved.error.message);
      await service.setProfileKey(saved.data.profileId, KEY);
      expect(await reviewerModeOf(service)).toEqual({
        kind: 'profile',
        profileLabel: ANTHROPIC_INPUT.label,
        tier: 'standard', // modelProfileInputSchema's default; ANTHROPIC_INPUT sets none
      });
      expect(revealSpy).not.toHaveBeenCalled();
    });

    it('a pinned but disabled profile renders blocked, not the subscription or a stale profile mode', async () => {
      const { service, revealSpy } = pinnedHarness();
      const saved = await service.saveProfile({ ...ANTHROPIC_INPUT, enabled: false });
      if (!saved.success) throw new Error(saved.error.message);
      const mode = await reviewerModeOf(service);
      expect(mode.kind).toBe('blocked');
      expect((mode as { reason: string }).reason).toMatch(/turned off/i);
      expect(revealSpy).not.toHaveBeenCalled();
    });

    it('a pinned profile with no key renders blocked, without ever calling reveal', async () => {
      const { service, revealSpy } = pinnedHarness();
      const saved = await service.saveProfile(ANTHROPIC_INPUT);
      if (!saved.success) throw new Error(saved.error.message);
      const mode = await reviewerModeOf(service);
      expect(mode.kind).toBe('blocked');
      expect((mode as { reason: string }).reason).toMatch(/no API key/i);
      expect(revealSpy).not.toHaveBeenCalled();
    });

    it('profiles off: reviewer reads as the subscription even with a pin configured, and keys are never touched', async () => {
      // Mirrors create-ninebrains-services.ts's fold: the pin closure itself resolves to null
      // while profiles are off, whatever the stored setting says — the same as `pin: null`.
      const { service, revealSpy } = pinnedHarness({ enabled: false, pin: null });
      const [claude, codex] = await service.agentCliStatus();
      for (const entry of [claude, codex]) {
        for (const { mode } of entry.roles) {
          expect(mode).toEqual({ kind: 'subscription' });
        }
      }
      expect(revealSpy).not.toHaveBeenCalled();
    });
  });
});

describe('T47: enabled() is read live, not cached at construction', () => {
  it('flips from off to on without recreating the service', async () => {
    let on = false;
    const { service } = harness({ enabled: () => on });
    expect(await service.listProfiles()).toEqual({ enabled: false, profiles: [], vendors: [] });
    on = true;
    expect((await service.listProfiles()).enabled).toBe(true);
  });

  it('flips from on to off without recreating the service, and stored profiles are then ignored', async () => {
    let on = true;
    const { service } = harness({ enabled: () => on });
    const saved = await service.saveProfile(ANTHROPIC_INPUT);
    if (!saved.success) throw new Error(saved.error.message);
    expect((await service.listProfiles()).profiles).toHaveLength(1);

    on = false;
    const listing = await service.listProfiles();
    expect(listing).toEqual({ enabled: false, profiles: [], vendors: [] });
    // The profile row itself is untouched (T47 requirement 4: off ignores it, never deletes it).
    on = true;
    expect((await service.listProfiles()).profiles).toHaveLength(1);
  });

  it('supports an async resolver, matching the real app-settings read', async () => {
    let on = false;
    const { service } = harness({ enabled: async () => on });
    expect((await service.listProfiles()).enabled).toBe(false);
    on = true;
    expect((await service.listProfiles()).enabled).toBe(true);
  });
});

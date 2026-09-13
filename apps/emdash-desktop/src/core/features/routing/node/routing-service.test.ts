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

function harness(overrides: Partial<RoutingServiceDeps> = {}) {
  const repo = createMemoryProfilesRepo();
  const sink = fakeSink();
  const keys = createProfileKeyStore(sink);
  const onError = vi.fn();
  const service = createRoutingService({
    enabled: true,
    profiles: repo,
    keys,
    testConnection: NOOP_TESTER,
    onError,
    now: () => 1_000,
    newId: (() => {
      let n = 0;
      return () => `profile-${++n}`;
    })(),
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
    const { service } = harness({ enabled: false });
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
    const { service } = harness({ enabled: false });
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

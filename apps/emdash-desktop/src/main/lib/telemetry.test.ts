import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    }
    async set(key: string, value: string): Promise<void> {
      store.set(key, value);
    }
    async del(key: string): Promise<void> {
      store.delete(key);
    }
  },
}));
vi.mock('@main/bootstrap/core/config', () => ({
  getAppConfig: () => ({ telemetryEnabled: true, installSource: undefined }),
}));
// Keys present in the environment on purpose: Ninebrains must ignore them.
vi.mock('@main/lib/env', () => ({
  env: {
    build: {
      VITE_POSTHOG_KEY: 'phc_must_never_be_used',
      VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
      VITE_BUILD: 'prod',
    },
    dev: { POSTHOG_PROJECT_API_KEY: 'phc_dev_key', POSTHOG_HOST: 'https://eu.i.posthog.com' },
  },
}));

async function productionTelemetry() {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  const { telemetryService } = await import('./telemetry');
  await telemetryService.initialize({ appVersion: '0.0.0-test', isPackaged: true });
  return telemetryService;
}

// Ninebrains telemetry policy (docs/UPSTREAM-PATCHES.md): off by default, pointed at nothing.
describe('Ninebrains telemetry defaults', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    store.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('defaults the telemetry preference to off on a fresh profile', async () => {
    const telemetry = await productionTelemetry();

    const status = telemetry.getTelemetryStatus();
    expect(status.userOptOut).toBe(true);
    expect(status.enabled).toBe(false);

    telemetry.capture('app_closed');
    telemetry.captureException(new Error('boom'));
    await telemetry.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing even after the user opts in, because no endpoint is configured', async () => {
    store.set('enabled', 'true');
    const telemetry = await productionTelemetry();
    telemetry.setTelemetryEnabledViaUser(true);

    const status = telemetry.getTelemetryStatus();
    expect(status.userOptOut).toBe(false);
    expect(status.hasKeyAndHost).toBe(false);
    expect(status.enabled).toBe(false);

    telemetry.capture('app_closed');
    telemetry.captureException(new Error('boom'));
    await telemetry.checkAndReportDailyActiveUser();
    await telemetry.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

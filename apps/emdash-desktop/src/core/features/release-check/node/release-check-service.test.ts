import { err, ok, type Result } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  shouldShowReleaseNotice,
  type LatestRelease,
  type ReleaseCheckFailure,
} from '../api/contract';
import {
  DEFAULT_RELEASE_CHECK_SETTINGS,
  releaseCheckSettingsSchema,
  type ReleaseCheckSettings,
} from '../contributions/settings';
import {
  AUTO_CHECK_INTERVAL_MS,
  MANUAL_CHECK_MIN_GAP_MS,
  ReleaseCheckService,
  STARTUP_CHECK_DELAY_MS,
  type ReleaseCheckTimers,
} from './release-check-service';

type Pending = { id: number; at: number; callback: () => void };

function harness(options: {
  version?: string;
  isPackaged?: boolean;
  isCanary?: boolean;
  settings?: Partial<ReleaseCheckSettings>;
  latest?: () => Result<LatestRelease, ReleaseCheckFailure>;
}) {
  let now = 1_000_000;
  let nextId = 1;
  let pending: Pending[] = [];
  const timers: ReleaseCheckTimers = {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      pending.push({ id, at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      pending = pending.filter((timer) => timer.id !== handle);
    },
  };
  let stored: ReleaseCheckSettings = { ...DEFAULT_RELEASE_CHECK_SETTINGS, ...options.settings };
  const changeListeners = new Set<() => void>();
  const release = (version: string): LatestRelease => ({
    version,
    releaseUrl: `https://github.com/Advance-Labs/ninebrains/releases/tag/v${version}`,
    publishedAt: null,
  });
  const fetchLatest = vi.fn(async () => (options.latest ?? (() => ok(release('0.2.0'))))());
  const service = new ReleaseCheckService({
    getCurrentVersion: async () => options.version ?? '0.1.0',
    isPackaged: options.isPackaged ?? true,
    isCanary: options.isCanary ?? false,
    fetchLatest,
    settings: {
      get: async () => stored,
      update: async (next) => {
        stored = next;
        for (const listener of changeListeners) listener();
      },
      onChange: (listener) => {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
    },
    now: () => now,
    timers,
  });

  return {
    service,
    fetchLatest,
    release,
    get stored() {
      return stored;
    },
    /** Writes the setting the way the Settings page does (app-settings wire controller). */
    async userSets(next: Partial<ReleaseCheckSettings>) {
      stored = { ...stored, ...next };
      for (const listener of changeListeners) listener();
      await flush();
    },
    pendingDelays: () => pending.map((timer) => timer.at - now),
    async advance(ms: number) {
      now += ms;
      const due = pending.filter((timer) => timer.at <= now);
      pending = pending.filter((timer) => timer.at > now);
      for (const timer of due) timer.callback();
      await flush();
    },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('ninebrains.releaseCheck settings', () => {
  it('ships with automatic checks off (SEC-38: no traffic the user did not start)', () => {
    expect(DEFAULT_RELEASE_CHECK_SETTINGS).toEqual({ autoCheck: false, dismissedVersion: null });
    expect(releaseCheckSettingsSchema.parse(DEFAULT_RELEASE_CHECK_SETTINGS)).toEqual(
      DEFAULT_RELEASE_CHECK_SETTINGS
    );
  });
});

describe('ReleaseCheckService automatic checks', () => {
  it('makes no request at all with the default settings', async () => {
    const h = harness({});
    await h.service.start();
    await h.advance(AUTO_CHECK_INTERVAL_MS * 3);

    expect(h.fetchLatest).not.toHaveBeenCalled();
    expect(h.pendingDelays()).toEqual([]);
  });

  it('checks once shortly after startup, then every 12 hours, when turned on', async () => {
    const h = harness({ settings: { autoCheck: true } });
    await h.service.start();
    expect(h.pendingDelays()).toEqual([STARTUP_CHECK_DELAY_MS]);

    await h.advance(STARTUP_CHECK_DELAY_MS);
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);
    expect(h.pendingDelays()).toEqual([AUTO_CHECK_INTERVAL_MS]);

    await h.advance(AUTO_CHECK_INTERVAL_MS - 1);
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('never checks automatically in an unpackaged (dev) build', async () => {
    const h = harness({ isPackaged: false, settings: { autoCheck: true } });
    await h.service.start();
    await h.advance(AUTO_CHECK_INTERVAL_MS);
    expect(h.fetchLatest).not.toHaveBeenCalled();
  });

  it('skips canary builds entirely, even for "Check now"', async () => {
    const h = harness({ isCanary: true, version: '0.2.1-canary.7', settings: { autoCheck: true } });
    await h.service.start();
    await h.advance(AUTO_CHECK_INTERVAL_MS);
    const status = await h.service.check();

    expect(h.fetchLatest).not.toHaveBeenCalled();
    expect(status.supported).toBe(false);
    expect(status.updateAvailable).toBe(false);
  });

  it('checks right away when the user turns it on, and stops when turned off', async () => {
    const h = harness({});
    await h.service.start();

    await h.userSets({ autoCheck: true });
    expect(h.pendingDelays()).toEqual([0]);
    await h.advance(0);
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);

    await h.userSets({ autoCheck: false });
    expect(h.pendingDelays()).toEqual([]);
    await h.advance(AUTO_CHECK_INTERVAL_MS * 2);
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('does not re-check early when toggled off and on again within 12 hours', async () => {
    const h = harness({ settings: { autoCheck: true } });
    await h.service.start();
    await h.advance(STARTUP_CHECK_DELAY_MS);

    await h.userSets({ autoCheck: false });
    await h.userSets({ autoCheck: true });
    expect(h.pendingDelays()).toEqual([AUTO_CHECK_INTERVAL_MS]);
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling once disposed', async () => {
    const h = harness({ settings: { autoCheck: true } });
    await h.service.start();
    h.service.dispose();
    await h.advance(AUTO_CHECK_INTERVAL_MS);
    expect(h.fetchLatest).not.toHaveBeenCalled();
  });
});

describe('ReleaseCheckService results', () => {
  it('reports a newer release', async () => {
    const h = harness({});
    const status = await h.service.check();

    expect(status).toMatchObject({
      currentVersion: '0.1.0',
      supported: true,
      autoCheck: false,
      checking: false,
      updateAvailable: true,
      latest: { version: '0.2.0' },
      lastFailure: null,
    });
    expect(status.lastCheckedAt).not.toBeNull();
  });

  it('reports no update when the running version is current or ahead', async () => {
    const same = await harness({ version: '0.2.0' }).service.check();
    const ahead = await harness({ version: '0.3.0-rc.1' }).service.check();
    expect(same.updateAvailable).toBe(false);
    expect(ahead.updateAvailable).toBe(false);
  });

  it('handles rate limiting and offline silently, keeping the last good answer', async () => {
    let answer: Result<LatestRelease, ReleaseCheckFailure> = ok({
      version: '0.2.0',
      releaseUrl: 'https://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.0',
      publishedAt: null,
    });
    const h = harness({ latest: () => answer });
    const first = await h.service.check();

    answer = err('rate-limited');
    await h.advance(MANUAL_CHECK_MIN_GAP_MS);
    const second = await h.service.check();
    expect(second).toMatchObject({
      updateAvailable: true,
      latest: { version: '0.2.0' },
      lastFailure: 'rate-limited',
      lastCheckedAt: first.lastCheckedAt,
    });

    answer = err('offline');
    await h.advance(MANUAL_CHECK_MIN_GAP_MS);
    expect((await h.service.check()).lastFailure).toBe('offline');
  });

  it('treats a throwing fetch as offline instead of failing the call', async () => {
    const h = harness({
      latest: () => {
        throw new Error('boom');
      },
    });
    const status = await h.service.check();
    expect(status.lastFailure).toBe('offline');
    expect(status.updateAvailable).toBe(false);
  });

  it('answers repeated "Check now" presses from memory for a minute', async () => {
    const h = harness({});
    await h.service.check();
    await h.service.check();
    expect(h.fetchLatest).toHaveBeenCalledTimes(1);

    await h.advance(MANUAL_CHECK_MIN_GAP_MS);
    await h.service.check();
    expect(h.fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('emits status to subscribers when a check finishes', async () => {
    const h = harness({});
    const seen: boolean[] = [];
    h.service.onStatus((status) => seen.push(status.updateAvailable));
    await h.service.check();
    expect(seen.at(-1)).toBe(true);
  });
});

describe('ReleaseCheckService dismissal', () => {
  it('hides the notice for that version only, and persists it', async () => {
    let latest = '0.2.0';
    const h = harness({
      latest: () =>
        ok({
          version: latest,
          releaseUrl: `https://github.com/Advance-Labs/ninebrains/releases/tag/v${latest}`,
          publishedAt: null,
        }),
    });
    expect(shouldShowReleaseNotice(await h.service.check())).toBe(true);

    expect(await h.service.dismiss('v0.2.0')).toEqual({ success: true, data: undefined });
    expect(h.stored.dismissedVersion).toBe('0.2.0');
    const dismissed = await h.service.getStatus();
    expect(shouldShowReleaseNotice(dismissed)).toBe(false);
    // The Settings card still offers the update.
    expect(dismissed.updateAvailable).toBe(true);

    latest = '0.2.1';
    await h.advance(MANUAL_CHECK_MIN_GAP_MS);
    expect(shouldShowReleaseNotice(await h.service.check())).toBe(true);
  });

  it('does not start a check or move the schedule when dismissing', async () => {
    const h = harness({ settings: { autoCheck: true } });
    await h.service.start();
    await h.service.dismiss('0.2.0');
    await flush();
    expect(h.pendingDelays()).toEqual([STARTUP_CHECK_DELAY_MS]);
    expect(h.fetchLatest).not.toHaveBeenCalled();
  });

  it('refuses a value that is not a version', async () => {
    const h = harness({});
    const result = await h.service.dismiss('../../etc');
    expect(result.success).toBe(false);
    expect(h.stored.dismissedVersion).toBeNull();
  });

  it('shows no notice when there is nothing newer', () => {
    expect(shouldShowReleaseNotice(null)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_TIMEOUT_MS, RESUME_CHECK_DELAY_MS, UpdateService } from './update-service';

const hoisted = vi.hoisted(() => {
  const app = {
    once: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    isPackaged: false,
  };
  return {
    app,
    updateEvents: { emit: vi.fn() },
    resolveAppVersion: vi.fn(async () => '0.0.0-test'),
  };
});

vi.mock('electron', () => ({
  app: hoisted.app,
  net: { fetch: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@core/features/updates/node', () => ({ updateEvents: hoisted.updateEvents }));
vi.mock('@main/core/app/utils', () => ({ resolveAppVersion: hoisted.resolveAppVersion }));
vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('UpdateService', () => {
  let service: UpdateService;
  const fetchImpl = vi.fn();

  beforeEach(() => {
    hoisted.app.once.mockClear();
    hoisted.updateEvents.emit.mockClear();
    hoisted.resolveAppVersion.mockClear();
    fetchImpl.mockReset();
    service = new UpdateService(fetchImpl);
  });

  afterEach(() => {
    service.dispose();
  });

  it('registers the Windows will-quit installer hook at construction', () => {
    expect(hoisted.app.once).toHaveBeenCalledWith('will-quit', expect.any(Function));
  });

  it('initializes but stays inactive in a dev/test build (no polling, no writes)', async () => {
    await service.initialize();
    expect(hoisted.resolveAppVersion).toHaveBeenCalled();
    expect(service.isActive).toBe(false);
    expect(hoisted.updateEvents.emit).not.toHaveBeenCalled();
  });

  it('never downloads while inactive', async () => {
    await service.initialize();
    await expect(service.downloadUpdate()).rejects.toThrow(/not active/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never installs while inactive', async () => {
    await service.initialize();
    expect(() => service.quitAndInstall()).toThrow(/not active/);
    expect(hoisted.app.relaunch).not.toHaveBeenCalled();
    expect(hoisted.app.quit).not.toHaveBeenCalled();
  });

  it('returns null from checks while inactive', async () => {
    await service.initialize();
    await expect(service.checkForUpdates()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exposes a snapshot state and tolerates dispose() twice', async () => {
    await service.initialize();
    const state = service.getState();
    expect(state).toMatchObject({ status: 'idle', currentVersion: '0.0.0-test' });
    expect(service.isInstallRequested).toBe(false);
    service.dispose();
    await expect(service.fetchReleaseNotes()).resolves.toBeNull();
  });

  // The active check path is gated behind a packaged, non-dev build; force it on for these.
  function activate(s: UpdateService): void {
    (s as unknown as { active: boolean }).active = true;
  }

  function emittedTypes(): string[] {
    return hoisted.updateEvents.emit.mock.calls.map((call) => (call[1] as { type: string }).type);
  }

  it('dismisses to not-available when a check fails, never stranding the UI on checking', async () => {
    activate(service);
    fetchImpl.mockRejectedValue(new Error('network down'));

    await service.checkForUpdates();

    const types = emittedTypes();
    expect(types).toContain('checking');
    expect(types).toContain('not-available');
    expect(types).not.toContain('error');
    expect(service.getState().status).toBe('idle');
  });

  it('times out a hung check and dismisses instead of hanging on checking', async () => {
    vi.useFakeTimers();
    try {
      activate(service);
      fetchImpl.mockReturnValue(new Promise(() => {})); // never resolves

      const check = service.checkForUpdates();
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 100);
      await check;

      const types = emittedTypes();
      expect(types).toContain('checking');
      expect(types).toContain('not-available');
      expect(service.getState().status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-checks shortly after a machine resume when active', async () => {
    vi.useFakeTimers();
    try {
      activate(service);
      fetchImpl.mockResolvedValue({ status: 404 } as Response); // 404 => no release, resolves fast

      service.onSystemResume();
      expect(fetchImpl).not.toHaveBeenCalled(); // deferred, not immediate
      await vi.advanceTimersByTimeAsync(RESUME_CHECK_DELAY_MS + 100);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(emittedTypes()).toContain('not-available');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a resume while inactive', () => {
    vi.useFakeTimers();
    try {
      service.onSystemResume();
      vi.advanceTimersByTime(RESUME_CHECK_DELAY_MS * 2);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

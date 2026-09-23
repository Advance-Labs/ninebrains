import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './update-service';

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
});

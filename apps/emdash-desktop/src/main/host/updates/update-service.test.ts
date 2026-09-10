import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateService } from './update-service';

const fakeUpdater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  autoRunAppAfterInstall: false,
  allowPrerelease: true,
  allowDowngrade: true,
  requestHeaders: {},
  logger: null as unknown,
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: fakeUpdater } }));
vi.mock('@main/core/app/utils', () => ({ resolveAppVersion: vi.fn(async () => '0.0.0-test') }));
vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@core/features/updates/node', () => ({ updateEvents: { emit: vi.fn() } }));

// Ninebrains update policy (docs/UPSTREAM-PATCHES.md): no feed is polled until the first
// Advance-Labs/ninebrains release, and nothing is ever downloaded or installed automatically.
describe('Ninebrains update policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not poll any update feed in a production build while UPDATES_ENABLED is off', async () => {
    vi.stubEnv('DEV', false);

    await updateService.initialize();

    expect(updateService.isActive).toBe(false);
    await expect(updateService.checkForUpdates()).resolves.toBeNull();
    expect(fakeUpdater.on).not.toHaveBeenCalled();
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('never downloads or installs on quit automatically, even once updates are enabled', () => {
    (updateService as unknown as { setupAutoUpdater(): void }).setupAutoUpdater();

    expect(fakeUpdater.autoDownload).toBe(false);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(false);
  });
});

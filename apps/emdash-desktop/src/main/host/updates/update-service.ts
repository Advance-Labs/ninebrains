import { promises as fs } from 'node:fs';
import type { Disposable } from '@emdash/shared/concurrency';
import { app, net } from 'electron';
import { updateEvents } from '@core/features/updates/node';
import { UPDATE_CHANNEL } from '@core/primitives/app-identity/api/app-identity';
import { UPDATES_ENABLED } from '@core/primitives/app-identity/api/fork-flags';
import { resolveAppVersion } from '@main/core/app/utils';
import { log } from '@main/lib/logger';
import { applyStagedUpdate, spawnWindowsInstaller } from './apply';
import { downloadAndHash, type DownloadProgress } from './download';
import { fetchLatestRelease, resolveInstaller, type FeedFetcher } from './feed';
import {
  clearPendingUpdate,
  clearPendingUpdateSync,
  readPendingUpdate,
  stagedFilePath,
  updatesRootDirectory,
  writePendingUpdate,
} from './staging';
import type { PendingUpdate, ReleaseInfo, ResolvedUpdate } from './types';
import { formatUpdaterError } from './utils';
import { compareVersions } from './version';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds
const INSTALL_RESTART_GUARD_TIMEOUT_MS = 2 * 60 * 1000;

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  lastCheck?: Date;
  nextCheck?: Date;
  currentVersion: string;
  availableVersion?: string;
  updateInfo?: ResolvedUpdate | ReleaseInfo;
  downloadProgress?: DownloadProgress;
  error?: string;
  rollbackVersion?: string;
  releaseNotes?: string;
}

export interface UpdateNotificationPublisher {
  available(version: string): void;
  downloaded(version: string): void;
  error(message: string): void;
}

const defaultFetcher: FeedFetcher = (input, init) =>
  net.fetch(input as string, init as RequestInit);

export class UpdateService implements Disposable {
  private updateState: UpdateState;
  private checkTimer?: NodeJS.Timeout;
  private currentCheckPromise: Promise<ReleaseInfo | null> | null = null;
  private initialized = false;
  private active = false;
  private installRequested = false;
  private installRestartGuardTimer?: NodeJS.Timeout;
  private pending?: PendingUpdate;
  private pendingWindowsInstaller?: string;
  private notificationPublisher?: UpdateNotificationPublisher;
  private readonly fetchImpl: FeedFetcher;

  constructor(fetchImpl: FeedFetcher = defaultFetcher) {
    this.fetchImpl = fetchImpl;
    this.updateState = { status: 'idle', currentVersion: 'unknown' };
    // Windows cannot overwrite the running exe, so the staged installer is launched from
    // `will-quit`, once the process is about to release its files (runAfterFinish relaunches).
    app.once('will-quit', () => this.runQueuedWindowsInstaller());
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.updateState.currentVersion = await resolveAppVersion();

    if (import.meta.env.DEV || !app.isPackaged || !UPDATES_ENABLED) return;

    this.active = true;

    await this.applyPendingUpdateAtBoot().catch((error) => {
      log.error('Failed to apply a pending update at boot', { error: formatUpdaterError(error) });
    });

    log.info('UpdateService initialized', {
      version: this.updateState.currentVersion,
      channel: UPDATE_CHANNEL,
    });

    this.scheduleNextCheck(STARTUP_DELAY_MS);
  }

  setNotificationPublisher(publisher: UpdateNotificationPublisher): void {
    this.notificationPublisher = publisher;
  }

  /**
   * Runs at startup, before the UI is ready: if a fully verified update was staged on a previous
   * run, apply it in place and restart onto the new version. Returns true when a relaunch was
   * requested so the boot can stop before creating the main window.
   */
  private async applyPendingUpdateAtBoot(): Promise<boolean> {
    const pending = await readPendingUpdate();
    if (!pending) return false;

    try {
      return await this.installStagedUpdate(pending);
    } catch (error) {
      // Never keep retrying a staged artifact that failed to apply; the running app still works.
      log.error('Applying staged update failed; discarding it', {
        version: pending.version,
        error: formatUpdaterError(error),
      });
      await clearPendingUpdate();
      return false;
    }
  }

  /** Applies a staged update now. Returns true when a relaunch onto the new version was requested. */
  private installStagedUpdate(pending: PendingUpdate): Promise<boolean> {
    if (process.platform === 'win32') {
      this.queueWindowsInstall(pending);
      return Promise.resolve(false);
    }
    return applyStagedUpdate(pending)
      .then(() => clearPendingUpdate())
      .then(() => {
        log.info('Restarting onto applied update', { version: pending.version });
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 100);
        return true;
      });
  }

  /** Windows: remember the installer, drop the marker, and let `will-quit` launch it. */
  private queueWindowsInstall(pending: PendingUpdate): void {
    this.pending = pending;
    this.pendingWindowsInstaller = pending.stagedPath;
    clearPendingUpdateSync();
    app.quit();
  }

  private runQueuedWindowsInstaller(): void {
    const installer = this.pendingWindowsInstaller;
    if (!installer) return;
    this.pendingWindowsInstaller = undefined;
    try {
      spawnWindowsInstaller(installer);
    } catch (error) {
      log.error('Failed to launch the Windows installer', { error: formatUpdaterError(error) });
    }
  }

  private clearInstallGuard(): void {
    if (this.installRestartGuardTimer) {
      clearTimeout(this.installRestartGuardTimer);
      this.installRestartGuardTimer = undefined;
    }
  }

  private scheduleNextCheck(delay = CHECK_INTERVAL_MS): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.updateState.nextCheck = new Date(Date.now() + delay);
    this.checkTimer = setTimeout(() => {
      this.checkForUpdates().catch((error) => {
        log.error('Scheduled update check failed', { error: formatUpdaterError(error) });
      });
    }, delay);
  }

  async checkForUpdates(): Promise<ReleaseInfo | null> {
    if (!this.active) return null;
    if (this.currentCheckPromise) return this.currentCheckPromise;

    this.currentCheckPromise = this.performCheck().finally(() => {
      this.currentCheckPromise = null;
      this.scheduleNextCheck();
    });
    return this.currentCheckPromise;
  }

  private async performCheck(): Promise<ReleaseInfo | null> {
    if (this.updateState.status === 'error') {
      this.updateState.status = 'idle';
      this.updateState.error = undefined;
    }

    log.info('Checking for updates', {
      channel: UPDATE_CHANNEL,
      currentVersion: this.updateState.currentVersion,
    });

    this.updateState.status = 'checking';
    this.updateState.lastCheck = new Date();
    updateEvents.emit(undefined, { type: 'checking' });

    const release = await fetchLatestRelease(this.fetchImpl);
    if (!release) {
      this.updateState.status = 'idle';
      updateEvents.emit(undefined, { type: 'not-available' });
      return null;
    }

    // Only the signed digest decides what may download, so resolve it before announcing anything.
    // Failure here (bad signature, no local installer) surfaces as an error, never as an update.
    const resolved = await resolveInstaller(release, this.fetchImpl);

    if (compareVersions(resolved.version, this.updateState.currentVersion) <= 0) {
      this.updateState.status = 'idle';
      updateEvents.emit(undefined, { type: 'not-available' });
      return null;
    }

    this.updateState.status = 'available';
    this.updateState.availableVersion = resolved.version;
    this.updateState.updateInfo = resolved;
    this.updateState.releaseNotes = release.releaseNotes;
    updateEvents.emit(undefined, { type: 'available', version: resolved.version });
    this.publishNotification((publisher) => publisher.available(resolved.version));
    return release;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.active) throw new Error('Update service is not active');
    if (this.updateState.status === 'error' && this.updateState.availableVersion) {
      this.updateState.status = 'available';
    }

    const resolved = this.updateState.updateInfo as ResolvedUpdate | undefined;
    if (!resolved || !resolved.digest || !resolved.asset) {
      throw new Error(
        `Cannot download without a verified update (status "${this.updateState.status}")`
      );
    }

    this.updateState.status = 'downloading';
    updateEvents.emit(undefined, { type: 'downloading', version: resolved.version });

    try {
      const root = updatesRootDirectory();
      const stagedPath = stagedFilePath(root, resolved.digest.name);
      const downloaded = await downloadAndHash(
        resolved.asset.url,
        stagedPath,
        (progress, _rate) => {
          this.updateState.downloadProgress = progress;
          updateEvents.emit(undefined, { type: 'progress', ...progress });
        },
        this.fetchImpl
      );

      if (downloaded.sha256 !== resolved.digest.sha256) {
        // downloadAndHash only cleans up on transport errors; a signed-digest mismatch leaves a
        // poisoned file on disk that must not survive to be applied.
        await fs.rm(stagedPath, { force: true });
        throw new Error(
          `Downloaded ${resolved.asset.name} does not match the signed digest (expected ${resolved.digest.sha256}, got ${downloaded.sha256})`
        );
      }

      this.pending = await writePendingUpdate({
        version: resolved.version,
        artifactName: resolved.digest.name,
        sha256: downloaded.sha256,
        size: downloaded.bytes,
        requestedAt: new Date().toISOString(),
      });

      this.updateState.status = 'downloaded';
      this.updateState.rollbackVersion = this.updateState.currentVersion;
      this.updateState.downloadProgress = {
        bytesPerSecond: downloaded.bytes,
        percent: 100,
        transferred: downloaded.bytes,
        total: downloaded.bytes,
      };
      updateEvents.emit(undefined, { type: 'downloaded', version: resolved.version });
      this.publishNotification((publisher) => publisher.downloaded(resolved.version));
    } catch (error) {
      const errorMessage = formatUpdaterError(error);
      log.error('Update download failed', { error: errorMessage });
      this.updateState.status = 'error';
      this.updateState.error = errorMessage;
      if (this.updateState.availableVersion) {
        updateEvents.emit(undefined, { type: 'error', message: errorMessage });
        this.publishNotification((publisher) => publisher.error(errorMessage));
      }
      throw error;
    }
  }

  quitAndInstall(): void {
    if (!this.active) throw new Error('Update service is not active');
    if (this.installRequested) {
      log.info('quitAndInstall ignored: install already requested');
      return;
    }
    if (this.updateState.status !== 'downloaded') {
      throw new Error(
        `Cannot install update: status is "${this.updateState.status}", expected "downloaded"`
      );
    }

    this.installRequested = true;
    this.updateState.status = 'installing';
    updateEvents.emit(undefined, { type: 'installing' });

    log.info('Installing update', {
      fromVersion: this.updateState.currentVersion,
      toVersion: this.updateState.availableVersion,
    });

    const staged = this.pending;
    if (!staged) {
      this.rollbackInstall('pending update record was lost before install');
      return;
    }

    this.clearInstallGuard();
    this.installRestartGuardTimer = setTimeout(() => {
      this.rollbackInstall('install timed out before app restart; allowing retry');
    }, INSTALL_RESTART_GUARD_TIMEOUT_MS);

    setTimeout(() => {
      this.installStagedUpdate(staged)
        .then(() => this.clearInstallGuard())
        .catch((error) => {
          this.rollbackInstall(`install failed: ${formatUpdaterError(error)}`);
        });
    }, 250);
  }

  private rollbackInstall(reason: string): void {
    if (this.installRestartGuardTimer) {
      clearTimeout(this.installRestartGuardTimer);
      this.installRestartGuardTimer = undefined;
    }
    this.installRequested = false;
    this.updateState.status = 'downloaded';
    if (this.updateState.availableVersion) {
      updateEvents.emit(undefined, {
        type: 'downloaded',
        version: this.updateState.availableVersion,
      });
      this.publishNotification((publisher) =>
        publisher.downloaded(this.updateState.availableVersion!)
      );
    }
    log.error(reason);
  }

  async fetchReleaseNotes(): Promise<string | null> {
    return this.updateState.releaseNotes ?? null;
  }

  getState(): UpdateState {
    return { ...this.updateState };
  }

  get isInstallRequested(): boolean {
    return this.installRequested;
  }

  get isActive(): boolean {
    return this.active;
  }

  private publishNotification(publish: (publisher: UpdateNotificationPublisher) => void): void {
    if (!this.notificationPublisher) return;
    try {
      publish(this.notificationPublisher);
    } catch (error) {
      log.warn('Failed to publish update notification', { error });
    }
  }

  dispose(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
    if (this.installRestartGuardTimer) {
      clearTimeout(this.installRestartGuardTimer);
      this.installRestartGuardTimer = undefined;
    }
  }
}

export const updateService = new UpdateService();

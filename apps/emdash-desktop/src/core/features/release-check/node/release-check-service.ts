import { err, ok, type Result } from '@emdash/shared';
import type {
  LatestRelease,
  ReleaseCheckError,
  ReleaseCheckFailure,
  ReleaseCheckStatus,
} from '../api/contract';
import { isNewerVersion, normalizeVersion, parseVersion } from '../api/version';
import type { ReleaseCheckSettings } from '../contributions/settings';

/** Automatic checks: at most one per this interval, counting any attempt. */
export const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** Let boot finish before the first automatic check. */
export const STARTUP_CHECK_DELAY_MS = 30 * 1000;
/** "Check now" presses closer together than this return the last answer without a request. */
export const MANUAL_CHECK_MIN_GAP_MS = 60 * 1000;

type TimerHandle = { unref?: () => unknown } | number;

export type ReleaseCheckTimers = {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};

export type ReleaseCheckSettingsPort = {
  get(): Promise<ReleaseCheckSettings>;
  update(next: ReleaseCheckSettings): Promise<void>;
  /** Called after any write to the setting, including from the Settings page. */
  onChange(listener: () => void): () => void;
};

export type ReleaseCheckServiceDeps = {
  getCurrentVersion(): Promise<string>;
  /** Automatic checks run only in packaged builds; "Check now" works everywhere. */
  isPackaged: boolean;
  isCanary: boolean;
  fetchLatest(): Promise<Result<LatestRelease, ReleaseCheckFailure>>;
  settings: ReleaseCheckSettingsPort;
  logger?: { warn(message: string, meta?: unknown): void };
  now?: () => number;
  timers?: ReleaseCheckTimers;
};

const defaultTimers: ReleaseCheckTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

/**
 * Tells the user a newer Ninebrains release exists. It never downloads or installs anything and
 * never touches electron-updater (SEC-36 stays as it is); the UI points at the download page and
 * the one-line installer instead.
 */
export class ReleaseCheckService {
  private readonly now: () => number;
  private readonly timers: ReleaseCheckTimers;
  private readonly listeners = new Set<(status: ReleaseCheckStatus) => void>();
  private currentVersion = 'unknown';
  private supported = false;
  private settings: ReleaseCheckSettings = { autoCheck: false, dismissedVersion: null };
  private latest: LatestRelease | null = null;
  private lastCheckedAt: number | null = null;
  private lastAttemptAt: number | null = null;
  private lastFailure: ReleaseCheckFailure | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: TimerHandle | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private started: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly deps: ReleaseCheckServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? defaultTimers;
  }

  /** Reads the version and setting, then schedules the startup check if the user wants one. */
  start(): Promise<void> {
    this.started ??= this.initialize();
    return this.started;
  }

  private async initialize(): Promise<void> {
    try {
      this.currentVersion = await this.deps.getCurrentVersion();
    } catch (error) {
      this.deps.logger?.warn('release-check: could not read the app version', { error });
    }
    this.supported = !this.deps.isCanary && parseVersion(this.currentVersion) !== null;
    this.settings = await this.readSettings();
    this.unsubscribeSettings = this.deps.settings.onChange(() => {
      void this.onSettingsChanged();
    });
    this.reschedule(STARTUP_CHECK_DELAY_MS);
  }

  onStatus(listener: (status: ReleaseCheckStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getStatus(): Promise<ReleaseCheckStatus> {
    await this.start();
    return this.snapshot();
  }

  /** User-initiated ("Check now"). Allowed with the automatic setting off. */
  async check(): Promise<ReleaseCheckStatus> {
    await this.start();
    if (!this.supported) return this.snapshot();
    const recent =
      this.lastAttemptAt !== null && this.now() - this.lastAttemptAt < MANUAL_CHECK_MIN_GAP_MS;
    if (!recent || this.inFlight) await this.runCheck();
    return this.snapshot();
  }

  async dismiss(version: string): Promise<Result<void, ReleaseCheckError>> {
    await this.start();
    const normalized = normalizeVersion(version);
    if (!normalized) {
      return err({ type: 'invalid-version', message: 'Not a release version.' });
    }
    try {
      this.settings = { ...(await this.readSettings()), dismissedVersion: normalized };
      await this.deps.settings.update(this.settings);
    } catch (error) {
      this.deps.logger?.warn('release-check: could not save the dismissed version', { error });
      return err({ type: 'persistence', message: 'Could not save that. Try again.' });
    }
    this.emit();
    return ok();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.listeners.clear();
  }

  private get autoAllowed(): boolean {
    return !this.disposed && this.deps.isPackaged && this.supported && this.settings.autoCheck;
  }

  private async onSettingsChanged(): Promise<void> {
    if (this.disposed) return;
    const wasOn = this.settings.autoCheck;
    this.settings = await this.readSettings();
    // Turning the setting on is itself a user action: check now unless one ran in the last 12 h.
    // Other writes (a dismissal) leave the schedule alone.
    if (wasOn !== this.settings.autoCheck) this.reschedule(0);
    this.emit();
  }

  /** Schedules the next automatic check, never sooner than 12 h after the last attempt. */
  private reschedule(minimumDelayMs: number): void {
    this.clearTimer();
    if (!this.autoAllowed) return;
    const dueAt =
      this.lastAttemptAt === null ? this.now() : this.lastAttemptAt + AUTO_CHECK_INTERVAL_MS;
    const delay = Math.max(minimumDelayMs, dueAt - this.now());
    const handle = this.timers.setTimeout(() => {
      this.timer = null;
      void this.runCheck().finally(() => this.reschedule(0));
    }, delay);
    if (typeof handle === 'object') handle.unref?.();
    this.timer = handle;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private runCheck(): Promise<void> {
    this.inFlight ??= this.performCheck().finally(() => {
      this.inFlight = null;
      this.emit();
    });
    this.emit();
    return this.inFlight;
  }

  private async performCheck(): Promise<void> {
    this.lastAttemptAt = this.now();
    let result: Result<LatestRelease, ReleaseCheckFailure>;
    try {
      result = await this.deps.fetchLatest();
    } catch {
      result = err('offline');
    }
    if (result.success) {
      this.latest = result.data;
      this.lastCheckedAt = this.now();
      this.lastFailure = null;
    } else {
      // Silent by design: keep whatever we knew, remember why this attempt failed.
      this.lastFailure = result.error;
    }
  }

  private async readSettings(): Promise<ReleaseCheckSettings> {
    try {
      return await this.deps.settings.get();
    } catch (error) {
      this.deps.logger?.warn('release-check: could not read settings', { error });
      return this.settings;
    }
  }

  private snapshot(): ReleaseCheckStatus {
    return {
      currentVersion: this.currentVersion,
      supported: this.supported,
      autoCheck: this.settings.autoCheck,
      checking: this.inFlight !== null,
      latest: this.latest,
      updateAvailable:
        this.supported &&
        this.latest !== null &&
        isNewerVersion(this.latest.version, this.currentVersion),
      lastCheckedAt: this.lastCheckedAt,
      lastFailure: this.lastFailure,
      dismissedVersion: this.settings.dismissedVersion,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    const status = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.deps.logger?.warn('release-check: status listener failed', { error });
      }
    }
  }
}

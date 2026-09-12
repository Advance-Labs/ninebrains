import type { GateCapabilities, ScreenshotCapture, Viewport } from '@emdash/gates-core';
import type { PublishNotification } from '@core/services/notifications/api';

/**
 * What the runner needs to know about the lane that did the work. It comes from
 * lane state in main, never from the job record: a job can't point the gates at
 * another worktree or browser.
 */
export interface GateLaneTarget {
  laneId: string;
  projectId: string;
  /** Absolute path of the lane's worktree. */
  worktreePath: string;
  /** The lane's own preview (a local dev server). The screenshot gate captures only this. */
  previewUrl?: string;
  /** The lane's stable browser id (lanes slice), for the CDP host. */
  browserId?: string;
  /** The lane's browser partition, for the offscreen fallback. */
  partition?: string;
}

export interface GateLaneResolver {
  resolve(laneId: string): Promise<GateLaneTarget | undefined>;
}

export interface LaneBrowserTarget {
  laneId: string;
  browserId?: string;
  partition?: string;
}

/**
 * The CDP gate host, implemented in main (`main/host/ninebrains/cdp-gate-host.ts`)
 * and injected here, because core may not import Electron.
 */
export interface ScreenshotHost {
  capture(
    target: LaneBrowserTarget,
    viewport: Viewport,
    opts: { url: string; signal: AbortSignal }
  ): Promise<ScreenshotCapture>;
}

/**
 * The capabilities shared by every job. `captureScreenshot` and
 * `readWorktreeFile` are bound per lane by the runner.
 */
export type GateRunnerCapabilities = Omit<
  GateCapabilities,
  'captureScreenshot' | 'readWorktreeFile'
>;

/** Structural subset of the notification service, so tests don't need the real one. */
export interface NotificationPublisher {
  publish(input: PublishNotification): string;
}

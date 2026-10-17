import { appendFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { app } from 'electron';
import { BRAND_SLUG } from '@core/primitives/app-identity/api/app-identity';
import type { Logger } from '@main/lib/logger';

/**
 * Ninebrains: enough evidence in the release log to tell a hang, a crash, a kill and a clean quit
 * apart. Release builds log warn and above, so every line here is warn or error.
 *
 * Added after a release instance beachballed and was force-quit with nothing in its log but a
 * burst of fs-watch warnings: no line said the main thread had stopped, nothing recorded memory,
 * and a clean quit looked the same as a kill.
 */
let diagnosticsLogPath: string | undefined;

/**
 * The normal quit path (the shutdown coordinator) ends in `app.exit()`, which skips `will-quit`
 * and ends the process before an async log write lands, so this line is written synchronously.
 */
export function recordCleanExit(code: number): void {
  if (!diagnosticsLogPath) return;
  try {
    appendFileSync(
      diagnosticsLogPath,
      `${JSON.stringify({ level: 'warn', time: new Date().toISOString(), proc: `${BRAND_SLUG}-main`, pid: process.pid, code, msg: 'quit: clean exit' })}\n`
    );
  } catch {
    // Nothing to report to: the log file is the thing that failed.
  }
}

export function registerCrashDiagnostics(log: Logger, logPath: string | undefined): void {
  diagnosticsLogPath = logPath;
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    log.error('child process gone', { ...details });
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    if (details.reason === 'clean-exit') return;
    // Origin and path only: a preview or OAuth page's query string can carry codes and tokens the
    // redactor does not recognise.
    log.error('renderer process gone', { ...details, url: safeUrl(webContents.getURL()) });
  });

  // `unresponsive` fires when a renderer stops answering. A blocked main thread cannot log at all;
  // the watchdog below covers that case.
  app.on('browser-window-created', (_event, window) => {
    let since: number | null = null;
    window.on('unresponsive', () => {
      since = Date.now();
      log.warn('window unresponsive');
    });
    window.on('responsive', () => {
      if (since === null) return;
      log.warn('window responsive again', { blockedMs: Date.now() - since });
      since = null;
    });
  });

  // Logged at warn so a release log can tell a clean quit from a kill: a log that ends without
  // this line ended in a crash, a force quit or SIGKILL. The coordinator's path is covered by
  // recordCleanExit; this covers quits that go through will-quit (update install, second instance).
  app.on('will-quit', () => log.warn('quit: clean exit'));

  void app.whenReady().then(() => startMemorySampler(log));
  if (logPath) startMainThreadWatchdog(logPath, log);
}

/** `origin + pathname`, or the scheme alone for anything that does not parse as a URL. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? `${parsed.protocol}…` : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

const SAMPLE_MS = 60_000;
const HIGH_MEMORY_KB = 3 * 1024 * 1024;
const REPEAT_HIGH_MEMORY_MS = 10 * 60_000;

export interface ProcessMemory {
  pid: number;
  type: string;
  name?: string;
  workingSetKb: number;
}

/**
 * The app's total working set, and its five largest processes, when the total is at or above
 * `thresholdKb`; null below it.
 */
export function memoryReport(
  processes: readonly ProcessMemory[],
  thresholdKb: number
): {
  totalMb: number;
  top: Array<{ pid: number; type: string; name?: string; mb: number }>;
} | null {
  const totalKb = processes.reduce((sum, p) => sum + p.workingSetKb, 0);
  if (totalKb < thresholdKb) return null;
  const top = [...processes]
    .sort((a, b) => b.workingSetKb - a.workingSetKb)
    .slice(0, 5)
    .map((p) => ({
      pid: p.pid,
      type: p.type,
      ...(p.name ? { name: p.name } : {}),
      mb: Math.round(p.workingSetKb / 1024),
    }));
  return { totalMb: Math.round(totalKb / 1024), top };
}

function startMemorySampler(log: Logger): void {
  let lastReport = 0;
  const timer = setInterval(() => {
    const report = memoryReport(
      app.getAppMetrics().map((m) => ({
        pid: m.pid,
        type: m.type,
        ...(m.name ? { name: m.name } : {}),
        workingSetKb: m.memory.workingSetSize,
      })),
      HIGH_MEMORY_KB
    );
    if (!report || Date.now() - lastReport < REPEAT_HIGH_MEMORY_MS) return;
    lastReport = Date.now();
    log.warn('app memory high', report);
  }, SAMPLE_MS);
  timer.unref();
}

/**
 * The watchdog's worker, as plain JavaScript: the main thread bumps a shared heartbeat every
 * 500 ms, and the worker, which keeps running while the main thread is stuck, appends to the log
 * file itself when the heartbeat stops. A beachball that ends in a force quit then leaves
 * "main thread blocked" as the log's last word instead of nothing.
 *
 * A string, not a stringified function, so no bundler helper can leak into it. Tested by running
 * it (crash-diagnostics.test.ts).
 */
export const WATCHDOG_SOURCE = `
const { workerData } = require('node:worker_threads');
const { appendFileSync } = require('node:fs');
const { path, beat, pid, proc, stallMs, repeatMs, pollMs } = workerData;
const heartbeat = new BigInt64Array(beat);
const nap = new Int32Array(new SharedArrayBuffer(4));
const write = (fields) => {
  try {
    appendFileSync(path, JSON.stringify({ level: 'warn', time: new Date().toISOString(), proc, pid, watchdog: 'main-thread', rssBytes: process.memoryUsage.rss(), ...fields }) + '\\n');
  } catch {}
};
let stalledAt = null;
let reportedAt = 0;
let polledAt = Date.now();
for (;;) {
  Atomics.wait(nap, 0, 0, pollMs);
  const now = Date.now();
  // The machine slept (or the clock jumped): this thread did not run either, so the silence is
  // not a hang. Skip one reading; the main thread beats again within half a second of waking.
  const asleep = now - polledAt > pollMs * 10;
  polledAt = now;
  if (asleep) continue;
  const last = Number(Atomics.load(heartbeat, 0));
  const silentMs = now - last;
  if (silentMs >= stallMs) {
    if (stalledAt === null) {
      stalledAt = last;
      reportedAt = now;
      write({ blockedMs: silentMs, msg: 'main thread blocked: the app is not responding' });
    } else if (now - reportedAt >= repeatMs) {
      reportedAt = now;
      write({ blockedMs: silentMs, msg: 'main thread still blocked' });
    }
  } else if (stalledAt !== null) {
    write({ blockedMs: last - stalledAt, msg: 'main thread recovered' });
    stalledAt = null;
  }
}
`;

export interface WatchdogOptions {
  stallMs?: number;
  repeatMs?: number;
  pollMs?: number;
  beatMs?: number;
}

/** Starts the heartbeat and its worker. Returns a stop function (tests; the app never stops it). */
export function startMainThreadWatchdog(
  logPath: string,
  log: Pick<Logger, 'warn'>,
  options: WatchdogOptions = {}
): () => Promise<void> {
  const beat = new SharedArrayBuffer(8);
  const heartbeat = new BigInt64Array(beat);
  const tick = () => Atomics.store(heartbeat, 0, BigInt(Date.now()));
  tick();
  const timer = setInterval(tick, options.beatMs ?? 500);
  timer.unref();

  let worker: Worker;
  try {
    worker = new Worker(WATCHDOG_SOURCE, {
      eval: true,
      workerData: {
        path: logPath,
        beat,
        pid: process.pid,
        proc: `${BRAND_SLUG}-main`,
        stallMs: options.stallMs ?? 5_000,
        repeatMs: options.repeatMs ?? 30_000,
        pollMs: options.pollMs ?? 1_000,
      },
    });
  } catch (error) {
    clearInterval(timer);
    log.warn('main-thread watchdog did not start', error);
    return async () => {};
  }
  worker.unref();
  worker.on('error', (error) => log.warn('main-thread watchdog stopped', error));
  worker.on('exit', (code) => {
    if (code !== 0 && code !== 1) log.warn('main-thread watchdog exited', { code });
  });
  return async () => {
    clearInterval(timer);
    await worker.terminate();
  };
}

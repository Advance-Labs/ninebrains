import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: () => new Promise(() => {}) },
}));

const { memoryReport, recordCleanExit, registerCrashDiagnostics, startMainThreadWatchdog } =
  await import('./crash-diagnostics');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Blocks this thread the way a stuck main process does: no timers, no I/O callbacks. */
const freeze = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('main-thread watchdog', () => {
  it('logs from its own thread while the main thread is blocked, again if it stays blocked, and on recovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'watchdog-'));
    dirs.push(dir);
    const path = join(dir, 'app.log');
    const log = { warn: vi.fn() };
    const stop = startMainThreadWatchdog(path, log, {
      stallMs: 200,
      repeatMs: 300,
      pollMs: 25,
      beatMs: 25,
    });
    await sleep(150); // the worker is up and the heartbeat is fresh

    freeze(700);
    await sleep(200); // the heartbeat resumes; the worker sees it
    await stop();

    const lines = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const messages = lines.map((line) => line.msg);
    expect(messages[0]).toBe('main thread blocked: the app is not responding');
    expect(messages).toContain('main thread still blocked');
    expect(messages.at(-1)).toBe('main thread recovered');
    expect(lines.at(-1)?.blockedMs).toBeGreaterThanOrEqual(600);
    for (const line of lines) {
      expect(line).toMatchObject({ level: 'warn', pid: process.pid, watchdog: 'main-thread' });
      expect(line.rssBytes).toBeGreaterThan(0);
    }
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('writes nothing while the main thread keeps beating', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'watchdog-'));
    dirs.push(dir);
    const path = join(dir, 'app.log');
    const stop = startMainThreadWatchdog(
      path,
      { warn: vi.fn() },
      { stallMs: 200, pollMs: 25, beatMs: 25 }
    );
    await sleep(500);
    await stop();
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });
});

describe('memoryReport', () => {
  const p = (pid: number, type: string, mb: number, name?: string) => ({
    pid,
    type,
    workingSetKb: mb * 1024,
    ...(name ? { name } : {}),
  });

  it('stays quiet below the threshold', () => {
    expect(memoryReport([p(1, 'Browser', 100), p(2, 'Tab', 200)], 1024 * 1024)).toBeNull();
  });

  it('reports the total and the five largest processes above it', () => {
    const report = memoryReport(
      [
        p(1, 'Browser', 300),
        p(2, 'Tab', 790),
        p(3, 'Tab', 787),
        p(4, 'Tab', 784),
        p(5, 'Tab', 779),
        p(6, 'Utility', 50, 'fs-watch'),
        p(7, 'GPU', 40),
      ],
      3 * 1024 * 1024
    );
    expect(report?.totalMb).toBe(3530);
    expect(report?.top.map((t) => t.pid)).toEqual([2, 3, 4, 5, 1]);
    expect(report?.top[0]).toEqual({ pid: 2, type: 'Tab', mb: 790 });
  });
});

describe('recordCleanExit', () => {
  it('appends a clean-exit line synchronously, so app.exit cannot cut it off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-exit-'));
    dirs.push(dir);
    const path = join(dir, 'app.log');
    registerCrashDiagnostics({ warn: vi.fn(), error: vi.fn() } as never, path);
    recordCleanExit(0);
    // Read back before any timer or I/O callback could run.
    const line = JSON.parse(readFileSync(path, 'utf8').trim().split('\n').at(-1)!) as Record<
      string,
      unknown
    >;
    expect(line).toMatchObject({
      level: 'warn',
      msg: 'quit: clean exit',
      code: 0,
      pid: process.pid,
    });
  });
});

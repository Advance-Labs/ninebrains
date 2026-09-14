/**
 * Process-group spawning and killing (SEC-16, SEC-30).
 *
 * POSIX: `detached: true` puts the child in a new process group whose id is its pid, so
 * `process.kill(-pgid)` reaches grandchildren (dev servers, test runners) too. Windows has no
 * process groups; `taskkill /T /F` walks the tree instead.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { assertSafeArgv, type ArgvGuardOptions } from './argv-guard';

export interface GroupSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  /** Written to stdin, which is then closed. Omitted: stdin is `/dev/null`. */
  stdin?: string;
  platform?: NodeJS.Platform;
  /**
   * `agent` (default) runs the SEC-12 argv guard. `command` is for non-agent processes the app
   * builds itself (tests gate, git), whose argv legitimately carries flags like `-c`.
   */
  kind?: 'agent' | 'command';
  /** Agent spawns: the provider and the config values Ninebrains wrote (SEC-12 / M2). */
  argvGuard?: ArgvGuardOptions;
}

/** SEC-16: absolute binary, argv array, no shell, new process group. SEC-12 guard on agents. */
export function spawnInGroup(
  binary: string,
  argv: readonly string[],
  options: GroupSpawnOptions
): ChildProcess {
  if (!isAbsolute(binary)) throw new Error(`Agent binary must be an absolute path: ${binary}`);
  if ((options.kind ?? 'agent') === 'agent') assertSafeArgv(argv, options.argvGuard);
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: (options.platform ?? process.platform) !== 'win32',
    windowsHide: true,
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  };
  const child = spawn(binary, [...argv], spawnOptions);
  if (options.stdin !== undefined && child.stdin) {
    child.stdin.on('error', () => {}); // the child may exit before reading its prompt
    child.stdin.end(options.stdin);
  }
  return child;
}

export function signalGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform = process.platform
): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    // No graceful tree signal on Windows: go straight to a forced tree kill.
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (err) {
    // ESRCH: the whole group is already gone. EPERM: under load, the OS can recycle a pid
    // (and thus this process-group id) between the leader exiting and this reap signal, so
    // `-pid` may now belong to a group we never started and don't own (R14: killing a reused
    // pid is worse, which is why we don't retry with a broader signal here either). Either way
    // there is nothing left of *our* group to signal, so this is not a failure worth throwing.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw err;
  }
}

/** A `signalGroup` failure `trySignalGroup` tolerated (never ESRCH/EPERM — those aren't reported). */
export type SignalFailure = { pid: number | undefined; signal: NodeJS.Signals; error: unknown };

export class StopLatchedError extends Error {
  constructor(what: string) {
    super(`STOP is latched: refusing to start ${what}`);
    this.name = 'StopLatchedError';
  }
}

/**
 * SEC-30: process groups started outside the run supervisor (tests-gate commands, review-checkout
 * git) register here, so the global STOP reaches them too. `ExecRunSupervisor.killAll()` latches
 * and kills this registry alongside its own runs; `clearStop()` clears both.
 */
export class ProcessGroupRegistry {
  private readonly live = new Map<ChildProcess, NodeJS.Platform>();
  private latched = false;

  get stopLatched(): boolean {
    return this.latched;
  }

  get size(): number {
    return this.live.size;
  }

  /** Throws `StopLatchedError` while STOP is latched. Call before spawning. */
  assertOpen(what: string): void {
    if (this.latched) throw new StopLatchedError(what);
  }

  /** Tracks `child` until it exits. */
  track(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    this.live.set(child, platform);
    child.once('exit', () => this.live.delete(child));
  }

  /**
   * Latches, then SIGTERMs every tracked group and SIGKILLs it after `graceMs`. A signal failure
   * (anything `signalGroup` doesn't already treat as "the group is gone") is always logged
   * (`trySignalGroup`); `onSignalFailure`, when given, also gets each one — the caller's own
   * place to record it, e.g. a run's transcript. Never throws; `killAll` still completes and
   * every group is still signalled even if every one of them fails.
   */
  async killAll(
    graceMs: number,
    onSignalFailure?: (failure: SignalFailure) => void
  ): Promise<void> {
    this.latched = true;
    await Promise.all(
      [...this.live].map(([child, platform]) =>
        terminateGroup(child, graceMs, platform, onSignalFailure).catch(() => undefined)
      )
    );
  }

  clearStop(): void {
    this.latched = false;
  }
}

/** The app-wide registry. Tests inject their own. */
export const processGroups = new ProcessGroupRegistry();

/**
 * SEC-30: `signalGroup` already tolerates ESRCH/EPERM (an already-gone or recycled group), but
 * `terminateGroup`'s whole contract is "always settles" — STOP (`killAll`) and the wall-clock
 * timeout both call it fire-and-forget (`void`), so any other exception here would otherwise
 * become an unhandled rejection instead of the resolved/rejected promise nobody is positioned to
 * catch. Always logs; also reports to `onFailure` when the caller has somewhere better to put it
 * (a run's transcript). Best effort either way: log/report, then move on.
 */
function trySignalGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform,
  onFailure?: (failure: SignalFailure) => void
): void {
  try {
    signalGroup(child, signal, platform);
  } catch (err) {
    console.error(
      `[process-group] signalGroup(${signal}) failed for pid ${child.pid ?? 'unknown'}:`,
      err
    );
    onFailure?.({ pid: child.pid, signal, error: err });
  }
}

/**
 * SIGTERM the group, then SIGKILL it after `graceMs` whether or not the leader exited, because
 * grandchildren that ignore SIGTERM outlive their parent. Resolves once the leader has exited.
 * `onSignalFailure`, when given, is called for each of the three signals here that fails (beyond
 * ESRCH/EPERM, which `signalGroup` already treats as "the group is gone" and never reports) — the
 * caller's hook to record it somewhere more durable than the console `trySignalGroup` always logs
 * to.
 */
export function terminateGroup(
  child: ChildProcess,
  graceMs: number,
  platform: NodeJS.Platform = process.platform,
  onSignalFailure?: (failure: SignalFailure) => void
): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
  trySignalGroup(child, 'SIGTERM', platform, onSignalFailure);
  const timer = setTimeout(
    () => trySignalGroup(child, 'SIGKILL', platform, onSignalFailure),
    graceMs
  );
  return exited.then(async () => {
    // The leader may exit on SIGTERM while a grandchild ignores it: finish the job.
    await new Promise((r) => setTimeout(r, Math.min(graceMs, 50)));
    clearTimeout(timer);
    trySignalGroup(child, 'SIGKILL', platform, onSignalFailure);
  });
}

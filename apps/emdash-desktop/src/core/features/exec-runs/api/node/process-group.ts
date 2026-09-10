/**
 * Process-group spawning and killing (SEC-16, SEC-30).
 *
 * POSIX: `detached: true` puts the child in a new process group whose id is its pid, so
 * `process.kill(-pgid)` reaches grandchildren (dev servers, test runners) too. Windows has no
 * process groups; `taskkill /T /F` walks the tree instead.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { assertSafeArgv } from './argv-guard';

export interface GroupSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  /** Written to stdin, which is then closed. Omitted: stdin is `/dev/null`. */
  stdin?: string;
  platform?: NodeJS.Platform;
}

/** SEC-16: absolute binary, argv array, no shell, new process group. SEC-12 guard on every call. */
export function spawnInGroup(
  binary: string,
  argv: readonly string[],
  options: GroupSpawnOptions
): ChildProcess {
  if (!isAbsolute(binary)) throw new Error(`Agent binary must be an absolute path: ${binary}`);
  assertSafeArgv(argv);
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
    // ESRCH: the whole group is already gone.
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
  }
}

/**
 * SIGTERM the group, then SIGKILL it after `graceMs` whether or not the leader exited, because
 * grandchildren that ignore SIGTERM outlive their parent. Resolves once the leader has exited.
 */
export function terminateGroup(
  child: ChildProcess,
  graceMs: number,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
  signalGroup(child, 'SIGTERM', platform);
  const timer = setTimeout(() => signalGroup(child, 'SIGKILL', platform), graceMs);
  return exited.then(async () => {
    // The leader may exit on SIGTERM while a grandchild ignores it: finish the job.
    await new Promise((r) => setTimeout(r, Math.min(graceMs, 50)));
    clearTimeout(timer);
    signalGroup(child, 'SIGKILL', platform);
  });
}

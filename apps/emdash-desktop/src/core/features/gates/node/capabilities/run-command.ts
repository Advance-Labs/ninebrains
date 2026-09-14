/**
 * `runCommand` for the tests gate and the reviewer's git calls (SEC-20).
 *
 * - Runs in an allowed lane worktree itself, or in a directory inside an allowed root (lane
 *   worktrees, review checkouts), checked by realpath (SEC-31 rule). Never at a denied root itself.
 * - Scrubbed env: no tokens, no `NINEBRAINS_*`, no provider secrets or accounts. `TMPDIR` points
 *   at a private per-command temp dir that is deleted afterwards.
 * - With `argv`, no shell: `command` is resolved to an absolute executable from the scrubbed PATH,
 *   skipping any PATH entry inside the cwd, so a binary planted in the worktree never runs (SEC-16).
 *   These are the gates' own git calls, so they also get `GIT_NO_LAZY_FETCH=1` (T32).
 * - New process group, registered with the SEC-30 registry so the global STOP reaches it. SIGTERM
 *   then SIGKILL on abort or timeout, and leftovers are reaped when the command exits. Output is
 *   capped at 1 MiB per stream (the tail is kept: failures are there).
 * - OS sandbox (`tests-sandbox.ts`): seatbelt on macOS, bubblewrap on Linux. Where neither exists
 *   (Linux without `bwrap`, Windows), a shell-line command (the tests gate) is refused unless the
 *   project sets `testsGate.allowUnsandboxed`. `argv` commands (gate-built git calls) still run.
 *
 * The shell line must come from app config the user set, never from a job record or a worktree
 * file (SEC-20 provenance rule). This capability can't check that; its caller must.
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { resolveLaneGitPaths } from '@core/features/exec-runs/api/node/lane-git-paths';
import {
  processGroups,
  signalGroup,
  spawnInGroup,
  terminateGroup,
  type ProcessGroupRegistry,
} from '@core/features/exec-runs/api/node/process-group';
import { buildScrubbedCommandEnv } from '@core/features/exec-runs/api/node/run-env';
import { resolveRunCwd } from '@core/features/exec-runs/api/node/run-paths';
import {
  gitControlPaths,
  secretDenyPaths,
} from '@core/features/exec-runs/api/node/sandbox-settings';
import {
  buildBwrapArgs,
  buildSeatbeltProfile,
  isInside,
  TestsSandboxUnavailableError,
  type TestsGateSettings,
} from './tests-sandbox';
import type { CommandResult, RunCommand } from './types';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export type TestsSandboxMode = 'seatbelt' | 'bwrap' | 'none';

export interface RunCommandOptions {
  /** Lane worktree roots and the review-checkout root. The cwd must be inside one. */
  allowedRoots: () => readonly string[];
  /** `<userData>/ninebrains`. */
  ninebrainsDataDir: string;
  /** All of `<userData>`, denied whole (M4). Default: the parent of `ninebrainsDataDir`. */
  userDataDir?: string;
  /** Other lanes' worktrees for this run's lane. */
  siblingWorktrees?: (cwd: string) => readonly string[];
  /** More paths to deny entirely, e.g. the review-checkout root. Ancestors of the cwd are skipped. */
  deniedPaths?: () => readonly string[];
  /**
   * Per-project settings (`testsGate.allowNetwork`, `testsGate.allowUnsandboxed`) for the
   * project that owns `cwd`. Both default to false.
   */
  projectSettings?: (cwd: string) => TestsGateSettings | Promise<TestsGateSettings>;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** `auto` (default): seatbelt on macOS, bubblewrap on Linux when installed. Others force a mode. */
  sandbox?: 'auto' | TestsSandboxMode;
  /** Absolute `bwrap`. Default: found on the app's PATH at creation. */
  bwrapPath?: string;
  /** The SEC-30 registry the global STOP kills. Default: the app-wide one. */
  groups?: ProcessGroupRegistry;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  homeDir?: string;
}

const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);

/** SEC-16: absolute, or found on PATH outside the cwd. Never a relative or worktree binary. */
export function resolveExecutable(
  command: string,
  envPath: string,
  cwd: string,
  platform: NodeJS.Platform
): string {
  if (isAbsolute(command)) return command;
  if (command.includes('/') || command.includes('\\')) {
    throw new Error(`Relative executable paths are refused: ${command}`);
  }
  const names = platform === 'win32' ? [`${command}.exe`, command] : [command];
  for (const dir of envPath.split(delimiter)) {
    if (!dir || !isAbsolute(dir) || isInside(real(dir), cwd)) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  throw new Error(`Executable not found on PATH: ${command}`);
}

class TailBuffer {
  private text = '';
  private truncated = false;
  constructor(private readonly max: number) {}
  push(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.max) {
      this.text = this.text.slice(-this.max);
      this.truncated = true;
    }
  }
  toString(): string {
    return this.truncated
      ? `[output truncated to the last ${this.max} bytes]\n${this.text}`
      : this.text;
  }
}

/**
 * The tests gate runs in the lane worktree itself, and each lane worktree is one of the allowed
 * roots. `resolveRunCwd`'s `exactRootsAllowed` (T43) is built for exactly this: a cwd that is
 * exactly an allowed root is accepted, unless that root is denied — the review-checkout root is,
 * so nothing runs at that shared root itself.
 */
async function resolveGateCwd(
  cwd: string,
  roots: readonly string[],
  denied: readonly string[]
): Promise<string> {
  const deniedReal = new Set(
    await Promise.all(denied.map((path) => realpath(path).catch(() => path)))
  );
  const exactRootsAllowed: string[] = [];
  for (const root of roots) {
    if (!isAbsolute(root)) continue;
    const info = await lstat(root).catch(() => undefined);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
    const realRoot = await realpath(root);
    if (!deniedReal.has(realRoot)) exactRootsAllowed.push(root);
  }
  return resolveRunCwd(cwd, roots, exactRootsAllowed);
}

function findBwrap(options: RunCommandOptions): string | undefined {
  if (options.bwrapPath) return options.bwrapPath;
  try {
    const path = (options.parentEnv ?? process.env).PATH ?? '';
    return resolveExecutable('bwrap', path, '/nonexistent-cwd', 'linux');
  } catch {
    return undefined;
  }
}

export function createRunCommand(options: RunCommandOptions): RunCommand {
  const platform = options.platform ?? process.platform;
  const graceMs = options.killGraceMs ?? 2000;
  const maxOutput = options.maxOutputBytes ?? 1024 * 1024;
  const groups = options.groups ?? processGroups;
  const userDataDir = options.userDataDir ?? dirname(options.ninebrainsDataDir);
  const bwrap = platform === 'linux' ? findBwrap(options) : undefined;
  const requested = options.sandbox ?? 'auto';
  const mode: TestsSandboxMode =
    requested !== 'auto'
      ? requested
      : platform === 'darwin' && existsSync(SANDBOX_EXEC)
        ? 'seatbelt'
        : bwrap
          ? 'bwrap'
          : 'none';
  if (mode === 'bwrap' && !bwrap)
    throw new Error('sandbox "bwrap" needs bwrapPath or bwrap on PATH');

  return async (command, opts) => {
    const cwd = await resolveGateCwd(
      opts.cwd,
      options.allowedRoots(),
      options.deniedPaths?.() ?? []
    );
    opts.signal.throwIfAborted();
    const settings = (await options.projectSettings?.(cwd)) ?? {};
    if (mode === 'none' && !opts.argv && settings.allowUnsandboxed !== true) {
      throw new TestsSandboxUnavailableError(`No OS sandbox is available on ${platform}.`);
    }
    groups.assertOpen('a tests-gate command');
    const base = buildScrubbedCommandEnv(
      options.parentEnv ?? process.env,
      platform === 'win32' ? 'windows' : 'posix'
    );
    const exec = opts.argv
      ? { file: resolveExecutable(command, base.PATH ?? '', cwd, platform), args: [...opts.argv] }
      : undefined;
    const tempDir = realpathSync(await mkdtemp(join(tmpdir(), 'nb-tests-')));
    const env: Record<string, string> = {
      ...base,
      TMPDIR: tempDir,
      ...(platform === 'win32' ? { TEMP: tempDir, TMP: tempDir } : {}),
      // T32: a gate-built git call never lazy-fetches a missing object through a promisor remote.
      ...(exec ? { GIT_NO_LAZY_FETCH: '1' } : {}),
    };
    // T36: the repo's git control files stay read-only, even when its .git is inside the cwd.
    const git =
      mode === 'none' || platform === 'win32'
        ? undefined
        : resolveLaneGitPaths(cwd, { parentEnv: options.parentEnv });
    const sandboxed = {
      worktree: cwd,
      tempDir,
      allowNetwork: settings.allowNetwork === true,
      readOnlyPaths: git ? gitControlPaths(git) : [],
      pinnedPaths: git ? [git.commonDir, git.gitDir, join(git.commonDir, 'info')] : [],
      deniedPaths: [
        options.ninebrainsDataDir,
        ...(options.siblingWorktrees?.(cwd) ?? []),
        ...(options.deniedPaths?.() ?? []),
        ...secretDenyPaths({ homeDir: options.homeDir, userDataDir }),
      ],
    };
    const target = exec ? [exec.file, ...exec.args] : ['/bin/sh', '-c', command];

    let binary: string;
    let argv: string[];
    if (platform === 'win32') {
      binary = exec?.file ?? `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`;
      argv = exec?.args ?? ['/d', '/s', '/c', command];
    } else if (mode === 'seatbelt') {
      binary = SANDBOX_EXEC;
      argv = ['-p', buildSeatbeltProfile(sandboxed), ...target];
    } else if (mode === 'bwrap') {
      binary = bwrap!;
      argv = [...buildBwrapArgs(sandboxed), '--', ...target];
    } else {
      [binary, ...argv] = target;
    }

    let child;
    try {
      child = spawnInGroup(binary, argv, { cwd, env, platform, kind: 'command' });
    } catch (err) {
      await rm(tempDir, { recursive: true, force: true });
      throw err;
    }
    groups.track(child, platform);
    const stdout = new TailBuffer(maxOutput);
    const stderr = new TailBuffer(maxOutput);
    child.stdout?.setEncoding('utf8').on('data', (c: string) => stdout.push(c));
    child.stderr?.setEncoding('utf8').on('data', (c: string) => stderr.push(c));

    let timedOut = false;
    const stop = () => void terminateGroup(child, graceMs, platform);
    const timer = setTimeout(
      () => {
        timedOut = true;
        stop();
      },
      opts.timeoutMs ?? options.defaultTimeoutMs ?? 10 * 60_000
    );
    opts.signal.addEventListener('abort', stop, { once: true });
    // A background process that keeps our pipes open would otherwise hold 'close' forever.
    child.once('exit', () => setTimeout(() => signalGroup(child, 'SIGKILL', platform), 50));

    return new Promise<CommandResult>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        opts.signal.removeEventListener('abort', stop);
        return rm(tempDir, { recursive: true, force: true });
      };
      child.once('error', (err) => void finish().finally(() => reject(err)));
      child.once('close', (code) => {
        void finish().finally(() =>
          resolve({
            exitCode: code,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            timedOut,
          })
        );
      });
    });
  };
}

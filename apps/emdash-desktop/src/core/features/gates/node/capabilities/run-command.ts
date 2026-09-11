/**
 * `runCommand` for the tests gate and the reviewer's git calls (SEC-20).
 *
 * - Runs in a directory inside the allowed roots (lane worktrees, review checkouts), checked by
 *   realpath (SEC-31 rule).
 * - Scrubbed env: no tokens, no `NINEBRAINS_*`, no provider secrets or accounts. `TMPDIR` points
 *   at a private per-command temp dir that is deleted afterwards.
 * - With `argv`, no shell: `command` is resolved to an absolute executable from the scrubbed PATH,
 *   skipping any PATH entry inside the cwd, so a binary planted in the worktree never runs (SEC-16).
 * - New process group; SIGTERM then SIGKILL on abort or timeout, and leftovers are reaped when
 *   the command exits. Output capped at 1 MiB per stream (the tail is kept: failures are there).
 * - macOS: wrapped in `sandbox-exec` with a profile that denies reading Ninebrains data, sibling
 *   worktrees and credential files, and allows writes only to the cwd, the private temp dir and
 *   `/dev`. The shared system temp dir is NOT writable, because review checkouts live there.
 *   Claude's sandbox can't wrap an arbitrary command we spawn ourselves, so this is the
 *   equivalent. Linux and Windows run without an OS sandbox: accepted risk, see the README.
 *
 * The shell line must come from app config the user set, never from a job record or a worktree
 * file (SEC-20 provenance rule). This capability can't check that; its caller must.
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import {
  signalGroup,
  spawnInGroup,
  terminateGroup,
} from '@core/features/exec-runs/api/node/process-group';
import { buildScrubbedCommandEnv } from '@core/features/exec-runs/api/node/run-env';
import { resolveRunCwd } from '@core/features/exec-runs/api/node/run-paths';
import { credentialDenyPaths } from '@core/features/exec-runs/api/node/sandbox-settings';
import type { CommandResult, RunCommand } from './types';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export interface RunCommandOptions {
  /** Lane worktree roots and the review-checkout root. The cwd must be inside one. */
  allowedRoots: () => readonly string[];
  /** `<userData>/ninebrains`. */
  ninebrainsDataDir: string;
  /** Other lanes' worktrees for this run's lane. */
  siblingWorktrees?: (cwd: string) => readonly string[];
  /** More paths to deny entirely, e.g. the review-checkout root. Ancestors of the cwd are skipped. */
  deniedPaths?: () => readonly string[];
  parentEnv?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** `auto` uses sandbox-exec on macOS when present. */
  sandbox?: 'auto' | 'off';
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  homeDir?: string;
}

const sbplString = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const real = (p: string) => (existsSync(p) ? realpathSync(p) : resolvePath(p));
const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/** Seatbelt profile: allow by default, deny reads of secrets, deny writes outside the cwd. */
export function buildSeatbeltProfile(input: {
  worktree: string;
  tempDir: string;
  deniedPaths: readonly string[];
}): string {
  const writable = [input.worktree, input.tempDir, '/dev'];
  // A denied ancestor of the cwd (e.g. the review-checkout root) would deny the cwd itself.
  const denied = [...new Set(input.deniedPaths.map(real))].filter(
    (p) => !isInside(input.worktree, p)
  );
  const subpaths = (paths: readonly string[]) =>
    paths.map((p) => `(subpath ${sbplString(p)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    ...(denied.length ? [`(deny file-read* file-write* ${subpaths(denied)})`] : []),
    `(deny file-write* (require-not (require-any ${subpaths(writable)})))`,
  ].join('\n');
}

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

export function createRunCommand(options: RunCommandOptions): RunCommand {
  const platform = options.platform ?? process.platform;
  const graceMs = options.killGraceMs ?? 2000;
  const maxOutput = options.maxOutputBytes ?? 1024 * 1024;
  const useSeatbelt =
    platform === 'darwin' && options.sandbox !== 'off' && existsSync(SANDBOX_EXEC);

  return async (command, opts) => {
    const cwd = await resolveRunCwd(opts.cwd, options.allowedRoots());
    opts.signal.throwIfAborted();
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
    };

    let binary: string;
    let argv: string[];
    if (platform === 'win32') {
      binary = exec?.file ?? `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\cmd.exe`;
      argv = exec?.args ?? ['/d', '/s', '/c', command];
    } else if (useSeatbelt) {
      const profile = buildSeatbeltProfile({
        worktree: cwd,
        tempDir,
        deniedPaths: [
          options.ninebrainsDataDir,
          ...(options.siblingWorktrees?.(cwd) ?? []),
          ...(options.deniedPaths?.() ?? []),
          ...credentialDenyPaths(options.homeDir),
        ],
      });
      binary = SANDBOX_EXEC;
      argv = ['-p', profile, ...(exec ? [exec.file, ...exec.args] : ['/bin/sh', '-c', command])];
    } else {
      binary = exec?.file ?? '/bin/sh';
      argv = exec?.args ?? ['-c', command];
    }

    let child;
    try {
      child = spawnInGroup(binary, argv, { cwd, env, platform });
    } catch (err) {
      await rm(tempDir, { recursive: true, force: true });
      throw err;
    }
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

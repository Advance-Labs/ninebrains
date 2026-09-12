/**
 * T36: where a lane worktree's git admin files live, for the SEC-11 write deny on the repo config,
 * attributes and hooks. Resolved with read-only git: no lazy fetch, fsmonitor or hooks, the
 * scrubbed env, and a cwd outside the worktree so a binary planted there never runs (SEC-16).
 * Synchronous because the attended launch path (`buildLaneLaunch`) is.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildScrubbedCommandEnv } from './run-env';

export interface LaneGitPaths {
  /** `$GIT_DIR`: `<common>/worktrees/<name>` for a linked worktree. */
  gitDir: string;
  /** `$GIT_COMMON_DIR`: the repo's `.git`, shared by every worktree. */
  commonDir: string;
}

export interface ResolveLaneGitPathsOptions {
  gitBinary?: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
}

/** The lane's git dirs, or undefined when the worktree is missing or not in a git repo. */
export function resolveLaneGitPaths(
  worktree: string,
  options: ResolveLaneGitPathsOptions = {}
): LaneGitPaths | undefined {
  if (!existsSync(worktree)) return undefined;
  let out: string;
  try {
    out = execFileSync(
      options.gitBinary ?? 'git',
      [
        '--no-lazy-fetch',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=/dev/null',
        '-C',
        worktree,
        'rev-parse',
        '--path-format=absolute',
        '--git-dir',
        '--git-common-dir',
      ],
      {
        cwd: tmpdir(),
        encoding: 'utf8',
        env: {
          ...buildScrubbedCommandEnv(options.parentEnv ?? process.env),
          GIT_NO_LAZY_FETCH: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      }
    );
  } catch (error) {
    if (/not a git repository/i.test(String((error as { stderr?: unknown }).stderr ?? ''))) {
      return undefined;
    }
    throw error;
  }
  const [gitDir, commonDir] = out.trim().split('\n');
  if (!gitDir || !commonDir) throw new Error(`Unexpected git rev-parse output: ${out}`);
  return { gitDir: realpathSync(gitDir), commonDir: realpathSync(commonDir) };
}

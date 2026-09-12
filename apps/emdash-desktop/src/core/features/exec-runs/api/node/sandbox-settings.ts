/**
 * SEC-11: the per-run Claude `--settings` file.
 *
 * Syntax checked against the Claude Code settings reference (Context7, 2026-09-10):
 * - `sandbox.filesystem.{denyRead,allowRead,allowWrite,denyWrite}` take plain absolute paths
 *   (or `~/`), enforced at the OS level for Bash and every subprocess.
 * - `permissions.deny` rules use gitignore-style patterns where `//path` is an absolute path;
 *   a single leading `/` would anchor to the settings file's directory instead.
 * - `allowUnsandboxedCommands: false` removes the `dangerouslyDisableSandbox` retry escape hatch.
 * - `failIfUnavailable` makes the CLI refuse to run rather than silently run unsandboxed
 *   (documented for the Agent SDK's sandbox object, which is the same settings block).
 */
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { LaneGitPaths } from './lane-git-paths';
import type { ExecPreset } from './types';

export interface SandboxSettingsInput {
  preset: ExecPreset;
  /** The run's own directory: the only place a worker may write. */
  worktree: string;
  /** `<userData>/ninebrains`: tokens, lane mcp.json, Brain DB, evidence, transcripts. */
  ninebrainsDataDir: string;
  /** All of `<userData>` (M4): app settings, other Emdash state, pack secrets. Denied whole. */
  userDataDir?: string;
  siblingWorktrees?: readonly string[];
  claudeConfigDir?: string;
  codexHome?: string;
  egressAllowedDomains?: readonly string[];
  homeDir?: string;
  /** The worktree's git dirs (`resolveLaneGitPaths`): their control files are write-denied (T36). */
  git?: LaneGitPaths;
}

export interface ClaudeSandboxSettings {
  sandbox: {
    enabled: true;
    failIfUnavailable: true;
    allowUnsandboxedCommands: false;
    autoAllowBashIfSandboxed: boolean;
    filesystem: {
      denyRead: string[];
      allowRead: string[];
      allowWrite: string[];
      denyWrite: string[];
    };
    network?: { allowedDomains: string[] };
  };
  permissions: { deny: string[] };
}

/**
 * M4: the one list of secret locations under home. The Claude settings file, the tests gate's
 * macOS seatbelt profile and its Linux bubblewrap tmpfs mounts all read it, so they can't drift.
 * `~/.cargo/credentials*` is spelled out as both files Cargo writes.
 */
export const SECRET_HOME_PATHS = [
  '.ssh',
  '.aws',
  '.azure',
  '.config/gcloud',
  '.config/gh',
  '.config/git/credentials',
  '.git-credentials',
  '.kube',
  '.docker/config.json',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.gnupg',
  '.codex',
  '.claude/.credentials.json',
  '.claude.json',
] as const;

/** Credential locations under `home`. */
export function credentialDenyPaths(home: string = homedir()): string[] {
  return SECRET_HOME_PATHS.map((p) => join(home, p));
}

/** Everything a run or the tests gate may never read: the home secrets plus all of `<userData>`. */
export function secretDenyPaths(input: { homeDir?: string; userDataDir?: string } = {}): string[] {
  return [
    ...(input.userDataDir ? [resolve(input.userDataDir)] : []),
    ...credentialDenyPaths(input.homeDir),
  ];
}

/**
 * T36: the repo files that make git run programs or pick filters: config (fsmonitor, filter
 * drivers, sshCommand, hooksPath), per-worktree config, `info/attributes`, hooks, and a linked
 * worktree's `.git` gitfile (which names the git dir, config included). The app runs git against
 * the repo outside any sandbox, so a lane may not write them. Objects, refs and the index stay
 * writable, so a lane can still commit.
 */
export function gitControlPaths(git: LaneGitPaths): string[] {
  return [
    ...new Set([
      ...(git.gitFile ? [git.gitFile] : []),
      join(git.commonDir, 'config'),
      join(git.commonDir, 'config.worktree'),
      join(git.gitDir, 'config.worktree'),
      join(git.commonDir, 'info', 'attributes'),
      join(git.commonDir, 'hooks'),
    ]),
  ];
}

const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export function buildClaudeSandboxSettings(input: SandboxSettingsInput): ClaudeSandboxSettings {
  const home = input.homeDir ?? homedir();
  const worktree = resolve(input.worktree);
  const denyRead = [
    resolve(input.ninebrainsDataDir),
    ...(input.siblingWorktrees ?? []).map((p) => resolve(p)),
    ...secretDenyPaths({ homeDir: home, userDataDir: input.userDataDir }),
    ...(input.claudeConfigDir ? [join(resolve(input.claudeConfigDir), '.credentials.json')] : []),
    ...(input.codexHome ? [resolve(input.codexHome)] : []),
  ].filter((p) => p !== worktree);

  // A worktree inside a denied path would make the deny list meaningless or the run unusable.
  const clash = denyRead.find((p) => isInside(worktree, p));
  if (clash) throw new Error(`Run directory ${worktree} lies inside a denied path ${clash}`);

  const unique = [...new Set(denyRead)];
  const gitDeny = input.git ? gitControlPaths(input.git) : [];
  const settings: ClaudeSandboxSettings = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // Reviewers get no Bash at all; workers' Bash runs sandboxed without prompts.
      autoAllowBashIfSandboxed: input.preset === 'worker',
      filesystem: {
        denyRead: unique,
        allowRead: [worktree],
        allowWrite: input.preset === 'worker' ? [worktree] : [],
        denyWrite: [...(input.preset === 'reviewer' ? [worktree] : []), ...gitDeny],
      },
    },
    permissions: {
      deny: [
        ...unique.flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]),
        // A reviewer may not modify even its own disposable checkout.
        ...(input.preset === 'reviewer' ? [`Edit(/${worktree}/**)`] : []),
        ...gitDeny.flatMap((p) => [`Edit(/${p})`, `Edit(/${p}/**)`]),
      ],
    },
  };
  if (input.egressAllowedDomains) {
    settings.sandbox.network = { allowedDomains: [...input.egressAllowedDomains] };
  }
  assertSafeSettings(settings);
  return settings;
}

/** The same invariants the argv guard enforces, for settings we write to disk. */
export function assertSafeSettings(settings: ClaudeSandboxSettings): void {
  const s = settings.sandbox;
  if (s.enabled !== true || s.allowUnsandboxedCommands !== false || s.failIfUnavailable !== true) {
    throw new Error('Sandbox settings must enable the sandbox and forbid unsandboxed commands');
  }
  if (JSON.stringify(settings).includes('bypassPermissions')) {
    throw new Error('Sandbox settings must not set bypassPermissions');
  }
}

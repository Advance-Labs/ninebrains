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
import type { ExecPreset } from './types';

export interface SandboxSettingsInput {
  preset: ExecPreset;
  /** The run's own directory: the only place a worker may write. */
  worktree: string;
  /** `<userData>/ninebrains`: tokens, lane mcp.json, Brain DB, evidence, transcripts. */
  ninebrainsDataDir: string;
  siblingWorktrees?: readonly string[];
  claudeConfigDir?: string;
  codexHome?: string;
  egressAllowedDomains?: readonly string[];
  homeDir?: string;
}

export interface ClaudeSandboxSettings {
  sandbox: {
    enabled: true;
    failIfUnavailable: true;
    allowUnsandboxedCommands: false;
    autoAllowBashIfSandboxed: boolean;
    filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] };
    network?: { allowedDomains: string[] };
  };
  permissions: { deny: string[] };
}

/** Credential and config locations every run is denied, relative to home. */
const HOME_DENY = [
  '.ssh',
  '.aws',
  '.config/gcloud',
  '.config/gh',
  '.codex',
  '.claude/.credentials.json',
  '.claude.json',
  '.netrc',
  '.npmrc',
  '.docker/config.json',
  '.kube',
  '.gnupg',
];

/** Credential locations under `home`, shared with the tests gate's macOS profile (SEC-20). */
export function credentialDenyPaths(home: string = homedir()): string[] {
  return HOME_DENY.map((p) => join(home, p));
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
    ...credentialDenyPaths(home),
    ...(input.claudeConfigDir ? [join(resolve(input.claudeConfigDir), '.credentials.json')] : []),
    ...(input.codexHome ? [resolve(input.codexHome)] : []),
  ].filter((p) => p !== worktree);

  // A worktree inside a denied path would make the deny list meaningless or the run unusable.
  const clash = denyRead.find((p) => isInside(worktree, p));
  if (clash) throw new Error(`Run directory ${worktree} lies inside a denied path ${clash}`);

  const unique = [...new Set(denyRead)];
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
        denyWrite: input.preset === 'reviewer' ? [worktree] : [],
      },
    },
    permissions: {
      deny: [
        ...unique.flatMap((p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`]),
        // A reviewer may not modify even its own disposable checkout.
        ...(input.preset === 'reviewer' ? [`Edit(/${worktree}/**)`] : []),
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

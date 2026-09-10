/**
 * Test helpers shared by the capability tests: temp git repos with a linked lane worktree,
 * a fake-claude wrapper, and a byte-level worktree snapshot for SEC-18.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_AGENT_DIR = fileURLToPath(
  new URL('../../../../../../../../tooling/fake-agent/', import.meta.url)
);
export const FAKE_CLAUDE = join(FAKE_AGENT_DIR, 'bin/fake-claude.mjs');
export const ECHO_MCP_SERVER = join(FAKE_AGENT_DIR, 'test/fixtures/echo-mcp-server.mjs');

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

export function tempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A main repo with one commit, plus a linked worktree per lane under `<root>/worktrees`. */
export function makeRepoWithLanes(root: string, lanes: string[]): { repo: string; worktrees: string; lanePaths: string[] } {
  const repo = join(root, 'repo');
  const worktrees = join(root, 'worktrees');
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktrees, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'tracked.txt'), 'original\n');
  writeFileSync(join(repo, 'doomed.txt'), 'to be deleted\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const lanePaths = lanes.map((name) => {
    const path = join(worktrees, name);
    git(repo, 'worktree', 'add', '-q', '-b', name, path);
    return path;
  });
  return { repo, worktrees, lanePaths };
}

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** The supervisor scrubs env, so fake-agent settings are baked into a wrapper script. */
export function fakeClaudeWrapper(dir: string, env: Record<string, string>): string {
  const path = join(dir, `fake-${randomUUID()}.sh`);
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}`);
  writeFileSync(path, ['#!/bin/sh', ...exports, `exec ${q(process.execPath)} ${q(FAKE_CLAUDE)} "$@"`, ''].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

/** Every entry under `dir` (including `.git`): type, content hash and mtime, plus git state. */
export function snapshotWorktree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, rel: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const key = rel ? `${rel}/${name}` : name;
      const info = lstatSync(path);
      if (info.isDirectory()) {
        walk(path, key);
      } else {
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        out[key] = `${info.mode}:${info.size}:${info.mtimeMs}:${hash}`;
      }
    }
  };
  walk(dir, '');
  out['@status'] = git(dir, 'status', '--porcelain');
  out['@head'] = git(dir, 'rev-parse', 'HEAD');
  return out;
}

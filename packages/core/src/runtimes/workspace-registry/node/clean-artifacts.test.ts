import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanWorkspaceArtifacts } from './clean-artifacts';

// The artifact clean removes exactly the reclaimable ignored roots `measureUsage`
// reports, never tracked or untracked-but-not-ignored files, and never a root that
// holds a preservePatterns match.

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe('cleanWorkspaceArtifacts', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-clean-')));
    git(root, 'init', '--initial-branch=main');
    await fs.writeFile(path.join(root, 'README.md'), '# repo\n');
    await fs.writeFile(
      path.join(root, '.gitignore'),
      'node_modules/\ndist/\n.env*\n*.log\nconfig/local/\n'
    );
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'initial');

    await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'dep\n');
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist', 'out.js'), 'built\n');
    await fs.writeFile(path.join(root, '.env'), 'SECRET=1\n');
    await fs.writeFile(path.join(root, 'debug.log'), 'log\n');
    await fs.mkdir(path.join(root, 'config', 'local'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'local', 'keys.json'), '{}\n');
    await fs.writeFile(path.join(root, 'untracked.txt'), 'untracked but not ignored\n');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('removes ignored roots and keeps tracked and untracked files', async () => {
    const result = await cleanWorkspaceArtifacts({ workspacePath: root, preservePatterns: [] });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.removed.sort()).toEqual(
      ['.env', 'config', 'debug.log', 'dist', 'node_modules'].sort()
    );
    expect(result.data.kept).toEqual([]);
    expect(await exists(path.join(root, 'node_modules'))).toBe(false);
    expect(await exists(path.join(root, 'dist'))).toBe(false);
    expect(await exists(path.join(root, 'README.md'))).toBe(true);
    expect(await exists(path.join(root, 'untracked.txt'))).toBe(true);
  });

  // git collapses a directory holding only ignored content into one root (`config/`),
  // so the kept root can be broader than the pattern: the clean errs toward keeping.
  it('keeps roots that equal or contain a preservePatterns match', async () => {
    const result = await cleanWorkspaceArtifacts({
      workspacePath: root,
      preservePatterns: ['.env*', 'config/local/keys.json'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kept.sort()).toEqual(['.env', 'config']);
    expect(result.data.removed.sort()).toEqual(['debug.log', 'dist', 'node_modules']);
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toBe('SECRET=1\n');
    expect(await exists(path.join(root, 'config', 'local', 'keys.json'))).toBe(true);
  });

  it('ignores unsafe preserve patterns rather than resolving them', async () => {
    const result = await cleanWorkspaceArtifacts({
      workspacePath: root,
      preservePatterns: ['../outside', '/etc/passwd'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kept).toEqual([]);
  });

  it('reports git failures outside a repository', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-clean-nogit-'));
    try {
      const result = await cleanWorkspaceArtifacts({
        workspacePath: outside,
        preservePatterns: [],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.type).toBe('git-command-failed');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

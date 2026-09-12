import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveLaneGitPaths } from './lane-git-paths';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-lane-git-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('T36 resolveLaneGitPaths', () => {
  it("finds a linked worktree's git dir and the shared common dir", () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', '.');
    git(repo, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
    const lane = join(root, 'lane-a');
    git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', lane);

    expect(resolveLaneGitPaths(lane)).toEqual({
      gitDir: join(repo, '.git', 'worktrees', 'lane-a'),
      commonDir: join(repo, '.git'),
    });
    expect(resolveLaneGitPaths(repo)).toEqual({
      gitDir: join(repo, '.git'),
      commonDir: join(repo, '.git'),
    });
  });

  it('returns undefined for a plain directory or a missing path', () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(resolveLaneGitPaths(plain)).toBeUndefined();
    expect(resolveLaneGitPaths(join(root, 'missing'))).toBeUndefined();
  });
});

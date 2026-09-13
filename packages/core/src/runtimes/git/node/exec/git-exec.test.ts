import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBoundExec, type BoundExec } from '#services/exec/api';
import { makeHostileRepo } from '#services/exec/node/hardened-git.test-fixtures';
import { bindGitDir, createGitExec, gitEnv } from './git-exec';

describe('gitEnv', () => {
  it('pins git output locale for stable parsing and error classification', () => {
    expect(gitEnv({ LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' })).toMatchObject({
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('defaults SSH to batch mode without overriding caller configuration', () => {
    expect(gitEnv({ GIT_SSH_COMMAND: undefined }).GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
    expect(gitEnv({ GIT_SSH_COMMAND: 'ssh -F custom-config' }).GIT_SSH_COMMAND).toBe(
      'ssh -F custom-config'
    );
  });

  it('loads the current environment for every git subprocess', async () => {
    let env = { EMDASH_ENV_REVISION: 'before-refresh' };
    const exec = createGitExec({
      cwd: process.cwd(),
      executable: process.execPath,
      env: async () => env,
    });

    const before = await exec.exec(['-p', 'process.env.EMDASH_ENV_REVISION']);
    env = { EMDASH_ENV_REVISION: 'after-refresh' };
    const after = await exec.exec(['-p', 'process.env.EMDASH_ENV_REVISION']);

    expect(before.stdout.trim()).toBe('before-refresh');
    expect(after.stdout.trim()).toBe('after-refresh');
  });
});

describe('T36 createGitExec hardening (real git)', () => {
  it('reads run no fsmonitor, filter, lazy fetch or ssh; the same argv unhardened does', async () => {
    const h = makeHostileRepo();
    try {
      const exec = createGitExec({ cwd: h.repo, env: h.env });
      await exec.exec(['--no-optional-locks', 'status', '--porcelain=v2', '-z', '-uall']);
      await exec.exec(['diff', '--numstat', 'HEAD', '--']);
      await exec.exec(['blame', '--porcelain', '--', 'a.txt']);
      await expect(exec.exec(['cat-file', '-p', 'HEAD:b.txt'])).rejects.toThrow();
      // The git worker binds a git dir; the driver listing must read that repo's config.
      await bindGitDir(createGitExec({ cwd: h.root, env: h.env }), join(h.repo, '.git'))
        .withCwd(h.repo)
        .exec(['status', '--porcelain']);
      expect(h.ran()).toEqual([]);

      const plain = createBoundExec({ file: 'git', cwd: h.repo, env: h.env });
      await plain.exec(['status', '--porcelain']);
      // status alone may skip the clean filter: a.txt changed size, so git marks it modified from
      // stat data without reading it (seen on CI's git 2.55). diff always reads it through the filter.
      await plain.exec(['diff', '--numstat', 'HEAD', '--']);
      await plain.exec(['cat-file', '-p', 'HEAD:b.txt']).catch(() => undefined);
      expect(h.ran()).toEqual(expect.arrayContaining(['filter', 'fsmonitor', 'ssh']));
    } finally {
      h.dispose();
    }
  });

  it("user writes keep the user's hooks but run no fsmonitor or repo core.sshCommand", async () => {
    const h = makeHostileRepo();
    try {
      const exec = createGitExec({ cwd: h.repo, env: h.env });
      await exec.exec(['commit', '-q', '--allow-empty', '-m', 'from the UI']);
      await expect(
        exec.exec(['push', 'origin', 'HEAD:main'], { timeoutMs: 30_000 })
      ).rejects.toThrow();
      expect(h.ran()).toContain('hook-pre-commit');
      expect(h.ran()).not.toContain('fsmonitor');
      expect(h.ran()).not.toContain('ssh');

      h.clear();
      const plain = createBoundExec({ file: 'git', cwd: h.repo, env: h.env });
      await plain.exec(['push', 'origin', 'HEAD:main']).catch(() => undefined);
      expect(h.ran()).toContain('ssh');
    } finally {
      h.dispose();
    }
  }, 60_000);
});

describe('bindGitDir', () => {
  it('binds every execution mode to one Git directory', async () => {
    const calls: string[][] = [];
    const makeExec = (cwd: string): BoundExec => ({
      file: 'git',
      cwd,
      async exec(args) {
        calls.push(args);
        return { stdout: '', stderr: '' };
      },
      async execStreaming(args) {
        calls.push(args);
      },
      async execBuffer(args) {
        calls.push(args);
        return { stdout: Buffer.alloc(0), stderr: '' };
      },
      spawn(args) {
        calls.push(args);
        return {} as never;
      },
      withCwd: makeExec,
    });
    const exec = bindGitDir(makeExec('/runtime'), '/repo/.git');

    await exec.exec(['status']);
    await exec.execStreaming(['fetch'], () => {});
    await exec.execBuffer(['cat-file', 'blob', 'HEAD:file']);
    await exec.spawn(['cat-file', '--batch']);
    const moved = exec.withCwd('/other');
    await moved.exec(['branch']);

    expect(calls).toEqual([
      ['--git-dir=/repo/.git', 'status'],
      ['--git-dir=/repo/.git', 'fetch'],
      ['--git-dir=/repo/.git', 'cat-file', 'blob', 'HEAD:file'],
      ['--git-dir=/repo/.git', 'cat-file', '--batch'],
      ['--git-dir=/repo/.git', 'branch'],
    ]);
    expect(moved.cwd).toBe('/other');
  });
});

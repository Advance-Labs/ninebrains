import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNonInteractiveGitExec } from '#services/exec/node/git-exec';
import { makeHostileRepo } from '#services/exec/node/hardened-git.test-fixtures';
import { createBoundExec } from './bound-exec';
import { gitCallKind, hardenedGitEnv, hardenGitExec, repoFilterDriverFlags } from './hardened-git';
import type { BoundExec } from './types';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('T36 gitCallKind', () => {
  it('reads read-only subcommands past global options, and everything else as the write kind', () => {
    expect(gitCallKind(['--no-optional-locks', 'status'], 'user-write')).toBe('read');
    expect(gitCallKind(['--git-dir=/r/.git', 'diff', '--numstat'], 'user-write')).toBe('read');
    expect(gitCallKind(['-c', 'a.b=c', '-C', '/x', 'cat-file', 'blob'], 'app-write')).toBe('read');
    expect(gitCallKind(['worktree', 'list', '--porcelain'], 'app-write')).toBe('read');
    for (const args of [['worktree', 'add', 'x'], ['commit', '-m', 'x'], ['fetch'], ['push']]) {
      expect(gitCallKind(args, 'app-write')).toBe('app-write');
      expect(gitCallKind(args, 'user-write')).toBe('user-write');
    }
  });
});

describe('T36 hardenedGitEnv', () => {
  it('appends after a caller GIT_CONFIG_COUNT and keeps a caller GIT_SSH_COMMAND', () => {
    const env = hardenedGitEnv(
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'Me',
        GIT_SSH_COMMAND: 'ssh -F mine',
      },
      'read'
    );
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_KEY_1: 'core.fsmonitor',
      GIT_CONFIG_VALUE_1: 'false',
      GIT_CONFIG_KEY_2: 'core.hooksPath',
      GIT_CONFIG_VALUE_2: '/dev/null',
      GIT_SSH_COMMAND: 'ssh -F mine',
      GIT_NO_LAZY_FETCH: '1',
    });
  });

  it('keeps hooks only for user writes, and lazy fetch for every write', () => {
    const app = hardenedGitEnv({}, 'app-write');
    const user = hardenedGitEnv({}, 'user-write');
    expect(app).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'core.hooksPath' });
    expect(user).toMatchObject({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor' });
    for (const env of [app, user]) {
      expect(env.GIT_NO_LAZY_FETCH).toBeUndefined();
      expect(env.GIT_SSH_COMMAND).toBe('ssh -o BatchMode=yes');
    }
  });
});

describe('T36 hardenGitExec argv', () => {
  function recording(configStdout = '') {
    const calls: string[][] = [];
    const exec: BoundExec = {
      file: 'git',
      cwd: '/repo',
      env: {},
      async exec(args) {
        calls.push(args);
        return { stdout: args.includes('config') ? configStdout : '', stderr: '' };
      },
      async execStreaming(args) {
        calls.push(args);
      },
      async execBuffer(args) {
        calls.push(args);
        return { stdout: Buffer.alloc(0), stderr: '' };
      },
      spawn: () => {
        throw new Error('unused');
      },
      withCwd: () => exec,
    };
    return { exec, calls };
  }

  it('adds --no-ext-diff/--no-textconv after the subcommand and blanks repo filters first', async () => {
    const { exec, calls } = recording('local\0filter.evil.clean\0global\0filter.lfs.clean\0');
    const git = hardenGitExec(exec, 'user-write');
    await git.exec(['--git-dir=/r/.git', 'diff', '--numstat', 'HEAD', '--']);
    await git.exec(['blame', '--porcelain', '--', 'a']);
    await git.exec(['log', '--format=%H']);
    await git.exec(['commit', '-m', 'x']);
    expect(calls).toEqual([
      [
        '--git-dir=/r/.git',
        'config',
        '--null',
        '--show-scope',
        '--name-only',
        '--get-regexp',
        '^filter\\.',
      ],
      [
        ...['-c', 'filter.evil.clean=', '-c', 'filter.evil.smudge=', '-c', 'filter.evil.process='],
        ...['-c', 'filter.evil.required=false', '--git-dir=/r/.git'],
        ...['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'HEAD', '--'],
      ],
      ['config', '--null', '--show-scope', '--name-only', '--get-regexp', '^filter\\.'],
      [
        ...['-c', 'filter.evil.clean=', '-c', 'filter.evil.smudge=', '-c', 'filter.evil.process='],
        ...['-c', 'filter.evil.required=false', 'blame', '--no-textconv', '--porcelain', '--', 'a'],
      ],
      ['log', '--no-ext-diff', '--no-textconv', '--format=%H'],
      ['commit', '-m', 'x'],
    ]);
  });

  it('fails closed on a filter name it cannot write as a -c key', async () => {
    const { exec } = recording('local\0filter.a=b;touch x.clean\0');
    await expect(hardenGitExec(exec, 'app-write').exec(['status'])).rejects.toThrow(/Refusing/);
  });
});

describe('T36 repoFilterDriverFlags (real git)', () => {
  it('blanks the repo own drivers and keeps global ones such as git-lfs', async () => {
    const h = makeHostileRepo();
    try {
      const globalConfig = join(h.root, 'global.gitconfig');
      execFileSync('git', ['config', '--file', globalConfig, 'filter.lfs.clean', 'git-lfs clean']);
      const exec = createBoundExec({
        file: 'git',
        cwd: h.repo,
        env: { ...h.env, GIT_CONFIG_GLOBAL: globalConfig },
      });
      const flags = await repoFilterDriverFlags(exec, []);
      expect(flags).toContain('filter.evil.clean=');
      expect(flags.join(' ')).not.toContain('lfs');
    } finally {
      h.dispose();
    }
  });
});

describe('T36 createNonInteractiveGitExec (real git, app-driven reads)', () => {
  it('runs no fsmonitor, filter or lazy fetch; the same argv unhardened runs all three', async () => {
    const h = makeHostileRepo();
    try {
      for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT']) {
        vi.stubEnv(key, h.env[key]);
      }
      vi.stubEnv('GIT_SSH_COMMAND', undefined);
      const exec = createNonInteractiveGitExec(h.repo);
      await exec.exec(['status', '--porcelain']);
      await exec.exec(['diff', '--numstat', 'HEAD', '--']);
      await expect(exec.exec(['cat-file', '-p', 'HEAD:b.txt'])).rejects.toThrow();
      expect(h.ran()).toEqual([]);

      const plain = createBoundExec({ file: 'git', cwd: h.repo, env: h.env });
      await plain.exec(['status', '--porcelain']);
      // status alone may skip the clean filter (a.txt changed size; see git-exec.test.ts).
      await plain.exec(['diff', '--numstat', 'HEAD', '--']);
      await plain.exec(['cat-file', '-p', 'HEAD:b.txt']).catch(() => undefined);
      expect(h.ran()).toEqual(expect.arrayContaining(['filter', 'fsmonitor', 'ssh']));
    } finally {
      h.dispose();
    }
  });
});

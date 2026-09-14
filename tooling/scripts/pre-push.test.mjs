// Run: node --test tooling/scripts/pre-push.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkCommands,
  checkEnv,
  GIT_REPO_ENV,
  parsePushLines,
  protectedRefProblems,
  runPrePush,
  ZERO_SHA,
} from './pre-push.mjs';

const SHA = 'b'.repeat(40);
const line = (remoteRef, localSha = SHA) => `refs/heads/x ${localSha} ${remoteRef} ${'c'.repeat(40)}`;

describe('protectedRefProblems', () => {
  it('refuses a push to main without the guard', () => {
    const problems = protectedRefProblems(parsePushLines(line('refs/heads/main')), {});
    assert.equal(problems.length, 1);
    assert.match(problems[0], /pnpm run merge <pr>/);
  });

  it('allows main only when the guard names the exact sha being pushed', () => {
    const updates = parsePushLines(line('refs/heads/main'));
    assert.deepEqual(protectedRefProblems(updates, { NINEBRAINS_MERGE_GUARD: SHA }), []);
    assert.equal(protectedRefProblems(updates, { NINEBRAINS_MERGE_GUARD: 'd'.repeat(40) }).length, 1);
    assert.equal(protectedRefProblems(updates, { NINEBRAINS_MERGE_GUARD: '1' }).length, 1);
  });

  it('never allows deleting main, guard or not', () => {
    const updates = parsePushLines(line('refs/heads/main', ZERO_SHA));
    assert.match(protectedRefProblems(updates, { NINEBRAINS_MERGE_GUARD: ZERO_SHA })[0], /delete/);
  });

  it('ignores other branches', () => {
    assert.deepEqual(protectedRefProblems(parsePushLines(line('refs/heads/feat/x')), {}), []);
  });
});

describe('checkCommands', () => {
  it('runs format:check, affected targets and the upstream-patch check', () => {
    const commands = checkCommands(parsePushLines(line('refs/heads/feat/x')), 'origin/main');
    assert.deepEqual(commands.map(([cmd, args]) => `${cmd} ${args.join(' ')}`), [
      'pnpm run format:check',
      'pnpm exec nx affected -t lint typecheck test --base=origin/main --head=HEAD',
      'node tooling/scripts/check-upstream-patches.mjs --base origin/main --head HEAD',
    ]);
  });

  it('runs nothing for a branch deletion', () => {
    assert.deepEqual(checkCommands(parsePushLines(line('refs/heads/feat/x', ZERO_SHA)), 'origin/main'), []);
  });
});

describe('runPrePush', () => {
  const git = (args) => (args[0] === 'status' ? '' : SHA);

  it('refuses main before running any check', () => {
    const ran = [];
    const code = runPrePush({ stdin: line('refs/heads/main'), env: {}, run: (c) => ran.push(c), git, log: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(ran, []);
  });

  it('stops at the first failing check and returns its status', () => {
    const ran = [];
    const run = (cmd, args) => {
      ran.push(args[0]);
      return args[0] === 'exec' ? 3 : 0;
    };
    const code = runPrePush({ stdin: line('refs/heads/feat/x'), env: {}, run, git, log: () => {} });
    assert.equal(code, 3);
    assert.deepEqual(ran, ['run', 'exec']);
  });

  it('falls back to local main when origin/main is missing', () => {
    const ran = [];
    const gitNoOrigin = (args) => {
      if (args[0] === 'rev-parse') throw new Error('missing');
      return '';
    };
    runPrePush({ stdin: line('refs/heads/feat/x'), env: {}, run: (cmd, args) => (ran.push(args.join(' ')), 0), git: gitNoOrigin, log: () => {} });
    assert.match(ran[1], /--base=main /);
  });

  it('runs every check without the repo-locating variables git gives the hook', () => {
    const envs = [];
    const env = { PATH: '/bin', GIT_DIR: '/repo/.git', GIT_INDEX_FILE: '/repo/.git/index' };
    runPrePush({ stdin: line('refs/heads/feat/x'), env, run: (cmd, args, childEnv) => (envs.push(childEnv), 0), git, log: () => {} });
    assert.equal(envs.length, 3);
    for (const childEnv of envs) assert.deepEqual(childEnv, { PATH: '/bin', EMDASH_TEST_SKIP_BROWSER: '1' });
  });

  it('skips the browser test projects, unless the pusher forces them on', () => {
    const envs = [];
    const run = (cmd, args, childEnv) => (envs.push(childEnv), 0);
    runPrePush({ stdin: line('refs/heads/feat/x'), env: {}, run, git, log: () => {} });
    assert.equal(envs[1].EMDASH_TEST_SKIP_BROWSER, '1');
    envs.length = 0;
    runPrePush({ stdin: line('refs/heads/feat/x'), env: { EMDASH_TEST_BROWSER: '1' }, run, git, log: () => {} });
    // vitest.config.ts: EMDASH_TEST_BROWSER=1 wins over EMDASH_TEST_SKIP_BROWSER.
    assert.equal(envs[1].EMDASH_TEST_BROWSER, '1');
  });
});

describe('checkEnv', () => {
  it('drops every repo-locating variable and injected -c config, and keeps the rest', () => {
    const env = Object.fromEntries(GIT_REPO_ENV.map((name) => [name, 'x']));
    Object.assign(env, { GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' });
    Object.assign(env, { PATH: '/bin', HOME: '/home/me', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Me' });
    assert.deepEqual(checkEnv(env), { PATH: '/bin', HOME: '/home/me', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Me' });
  });

  it('covers every variable `git rev-parse --local-env-vars` names', () => {
    const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.deepEqual(local.filter((name) => !GIT_REPO_ENV.includes(name)), []);
  });

  it('keeps a git child in its own cwd when the hook env points at another repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-prepush-env-'));
    try {
      const pushed = join(root, 'pushed');
      const fixture = join(root, 'fixture');
      execFileSync('git', ['init', '-q', pushed]);
      execFileSync('mkdir', ['-p', fixture]);
      const hookEnv = { ...process.env, GIT_DIR: join(pushed, '.git') };
      execFileSync('git', ['init', '-q'], { cwd: fixture, env: checkEnv(hookEnv) });
      assert.ok(existsSync(join(fixture, '.git')), 'the fixture got its own repo');
      const bare = execFileSync('git', ['config', '--get', 'core.bare'], { cwd: pushed, encoding: 'utf8' }).trim();
      assert.equal(bare, 'false', 'the pushed repo is untouched');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

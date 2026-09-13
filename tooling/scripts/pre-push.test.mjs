// Run: node --test tooling/scripts/pre-push.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCommands, parsePushLines, protectedRefProblems, runPrePush, ZERO_SHA } from './pre-push.mjs';

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
});

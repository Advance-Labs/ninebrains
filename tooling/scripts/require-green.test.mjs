// Run: node --test tooling/scripts/require-green.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkStatus, latestCheck, resolveRepo, waitForStatus } from './require-green.mjs';

const SHA = 'a'.repeat(40);
const run = (overrides = {}) => ({
  id: 1,
  name: 'ci-ok',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-09-12T10:00:00Z',
  html_url: 'https://github.com/o/r/runs/1',
  app: { slug: 'github-actions' },
  ...overrides,
});
const ghReturning = (checkRuns, calls = []) => (args) => {
  calls.push(args);
  return JSON.stringify({ total_count: checkRuns.length, check_runs: checkRuns });
};

describe('latestCheck', () => {
  it('takes the newest ci-ok run and ignores other apps and names', () => {
    const newest = run({ id: 3, started_at: '2026-09-12T12:00:00Z', conclusion: 'failure' });
    const picked = latestCheck([
      run({ id: 1 }),
      newest,
      run({ id: 4, started_at: '2026-09-12T13:00:00Z', app: { slug: 'some-other-app' } }),
      run({ id: 5, started_at: '2026-09-12T14:00:00Z', name: 'static' }),
    ]);
    assert.equal(picked, newest);
  });
});

describe('checkStatus', () => {
  it('asks GitHub for the latest ci-ok run on the exact commit', () => {
    const calls = [];
    const status = checkStatus({ repo: 'o/r', sha: SHA, gh: ghReturning([run()], calls) });
    assert.equal(status.state, 'green');
    assert.deepEqual(calls, [['api', `repos/o/r/commits/${SHA}/check-runs?check_name=ci-ok&filter=latest&per_page=100`]]);
  });

  it('reports missing, pending and red', () => {
    assert.equal(checkStatus({ repo: 'o/r', sha: SHA, gh: ghReturning([]) }).state, 'missing');
    assert.equal(
      checkStatus({ repo: 'o/r', sha: SHA, gh: ghReturning([run({ status: 'in_progress', conclusion: null })]) }).state,
      'pending'
    );
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral']) {
      assert.equal(checkStatus({ repo: 'o/r', sha: SHA, gh: ghReturning([run({ conclusion })]) }).state, 'red', conclusion);
    }
  });

  it('never counts a ci-ok check from another app', () => {
    const fake = run({ app: { slug: 'attacker-app' } });
    assert.equal(checkStatus({ repo: 'o/r', sha: SHA, gh: ghReturning([fake]) }).state, 'missing');
  });

  it('refuses a short SHA or a branch name', () => {
    for (const sha of ['abc1234', 'main', `${SHA}0`]) {
      assert.throws(() => checkStatus({ repo: 'o/r', sha, gh: ghReturning([run()]) }), /full 40-character/);
    }
  });
});

describe('waitForStatus', () => {
  it('polls through pending until the check completes', async () => {
    const answers = [[run({ status: 'queued', conclusion: null })], [], [run()]];
    const gh = () => JSON.stringify({ check_runs: answers.shift() });
    const sleeps = [];
    const status = await waitForStatus({ repo: 'o/r', sha: SHA, gh, sleep: async (ms) => sleeps.push(ms), intervalMs: 5 });
    assert.equal(status.state, 'green');
    assert.deepEqual(sleeps, [5, 5]);
  });

  it('gives up on the deadline and returns the last state', async () => {
    let clock = 0;
    const gh = () => JSON.stringify({ check_runs: [run({ status: 'in_progress', conclusion: null })] });
    const status = await waitForStatus({
      repo: 'o/r',
      sha: SHA,
      gh,
      timeoutMs: 30,
      intervalMs: 10,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    assert.equal(status.state, 'pending');
    assert.equal(clock, 30);
  });
});

describe('resolveRepo', () => {
  const origin = (url) => () => url;

  it('prefers $GITHUB_REPOSITORY in Actions', () => {
    const repo = resolveRepo({ env: { GITHUB_REPOSITORY: 'Advance-Labs/ninebrains' }, originUrl: origin('x') });
    assert.equal(repo, 'Advance-Labs/ninebrains');
  });

  it('reads the origin remote, never gh: an upstream remote cannot win', () => {
    for (const url of [
      'https://github.com/Advance-Labs/ninebrains.git',
      'https://github.com/Advance-Labs/ninebrains',
      'https://github.com/Advance-Labs/ninebrains/',
      'git@github.com:Advance-Labs/ninebrains.git',
      'ssh://git@github.com/Advance-Labs/ninebrains.git',
    ]) {
      assert.equal(resolveRepo({ env: {}, originUrl: origin(url) }), 'Advance-Labs/ninebrains', url);
    }
  });

  it('refuses an origin it cannot read as a GitHub repo, and names --repo', () => {
    for (const url of ['https://gitlab.com/o/r.git', '/local/path/repo', '']) {
      assert.throws(() => resolveRepo({ env: {}, originUrl: origin(url) }), /pass --repo owner\/name/, url);
    }
  });
});

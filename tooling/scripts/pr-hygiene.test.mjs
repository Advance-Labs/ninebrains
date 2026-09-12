// Run: node --test tooling/scripts/pr-hygiene.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPrHygiene, checkTitle, DCO_CUTOFF, dcoProblems, parseCommits } from './pr-hygiene.mjs';

const commit = (overrides = {}) => ({
  sha: 'a'.repeat(40),
  parents: ['p1'],
  name: 'Lukce',
  email: 'dev@example.com',
  body: 'feat(x): thing\n\nSigned-off-by: Lukce <dev@example.com>\n',
  ...overrides,
});

describe('checkTitle', () => {
  it('accepts Conventional Commit titles, with or without a scope or bang', () => {
    for (const title of [
      'feat(lanes): add a grid',
      'fix: handle an empty pid file',
      'ci(release)!: require green CI',
      'docs(guide, release): two scopes',
    ]) {
      assert.equal(checkTitle(title), null, title);
    }
  });

  it('rejects anything else', () => {
    for (const title of ['Add a grid', 'feature(lanes): x', 'fix(lanes) missing colon', 'fix: ', '', undefined]) {
      assert.match(checkTitle(title), /not a Conventional Commit/, String(title));
    }
  });
});

describe('dcoProblems', () => {
  it('passes a commit signed off with its author email, in any case', () => {
    assert.deepEqual(dcoProblems([commit({ email: 'Dev@Example.com' })]), []);
  });

  it('fails a missing or mismatched sign-off', () => {
    const problems = dcoProblems([
      commit({ sha: 'b1', body: 'fix: x\n' }),
      commit({ sha: 'b2', body: 'fix: x\n\nSigned-off-by: Someone <other@example.com>\n' }),
    ]);
    assert.deepEqual(
      problems.map((p) => [p.sha, p.reason.startsWith('no') ? 'missing' : 'mismatch']),
      [
        ['b1', 'missing'],
        ['b2', 'mismatch'],
      ]
    );
  });

  it('skips merge commits and exempt commits', () => {
    const unsigned = { body: 'x\n' };
    const problems = dcoProblems(
      [commit({ ...unsigned, sha: 'm', parents: ['p1', 'p2'] }), commit({ ...unsigned, sha: 'old' })],
      { isExempt: (sha) => sha === 'old' }
    );
    assert.deepEqual(problems, []);
  });

  it('does not accept a sign-off quoted mid-line', () => {
    const body = 'fix: x\n\nsee "Signed-off-by: Lukce <dev@example.com>" above\n';
    assert.equal(dcoProblems([commit({ body })]).length, 1);
  });
});

describe('checkPrHygiene', () => {
  it('parses git log records and asks git which commits predate the cutoff', () => {
    const log = [
      `new1\x1fp1\x1fLukce\x1fdev@example.com\x1ffix: a\n\nSigned-off-by: Lukce <dev@example.com>\n\x1e`,
      `\nold1\x1fp0\x1fLukce\x1fdev@example.com\x1fchore: unsigned\n\x1e`,
      `\nnew2\x1fp2\x1fLukce\x1fdev@example.com\x1ffix: unsigned\n\x1e\n`,
    ].join('');
    assert.equal(parseCommits(log).length, 3);
    const git = (args) => {
      if (args[0] === 'log') return log;
      if (args[0] === 'merge-base' && args[2] === 'old1' && args[3] === DCO_CUTOFF) return '';
      throw new Error('not an ancestor');
    };
    const result = checkPrHygiene({ base: 'b', head: 'h', title: 'Fix things', git });
    assert.equal(result.commits, 3);
    assert.deepEqual(result.dco.map((p) => p.sha), ['new2']);
    assert.match(result.title, /not a Conventional Commit/);
  });
});

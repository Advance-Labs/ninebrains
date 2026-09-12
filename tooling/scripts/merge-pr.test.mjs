// Run: node --test tooling/scripts/merge-pr.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  codeownersPatternToRegex,
  mergePr,
  SECURITY_BEGIN,
  SECURITY_END,
  securityFiles,
  securityPatterns,
} from './merge-pr.mjs';

const SHA = 'e'.repeat(40);
const MERGE_SHA = 'f'.repeat(40);
const CODEOWNERS = [
  '# comment',
  '/docs/guide/ @someone',
  SECURITY_BEGIN,
  '/packages/brain-core/ @zordhalo',
  '/.github/ @zordhalo',
  '/apps/emdash-desktop/electron-builder.config.ts @zordhalo',
  '# a comment inside the section',
  '/docs/THREAT-MODEL.md @zordhalo',
  SECURITY_END,
  '/README.md @someone',
].join('\n');

/** A fake `gh` keyed on its first arguments; records every call. */
function fakeGh({ view = {}, checkRuns, behind = 0, files = ['docs/guide/x.md'], runs = [{ databaseId: 7, url: 'u' }] } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    const [a, b] = args;
    if (a === 'pr' && b === 'view' && args.includes('mergeCommit')) return `${MERGE_SHA}\n`;
    if (a === 'pr' && b === 'view') {
      return JSON.stringify({
        number: 12,
        title: 'feat(lanes): add a grid',
        url: 'https://github.com/o/r/pull/12',
        state: 'OPEN',
        isDraft: false,
        headRefOid: SHA,
        headRefName: 'feat/grid',
        baseRefName: 'main',
        labels: [],
        ...view,
      });
    }
    if (a === 'api' && b.includes('/check-runs')) {
      return JSON.stringify({
        check_runs: checkRuns ?? [
          { id: 1, name: 'ci-ok', status: 'completed', conclusion: 'success', started_at: 't', app: { slug: 'github-actions' } },
        ],
      });
    }
    if (a === 'api' && b.includes('/compare/')) return `${behind}\n`;
    if (a === 'api' && b === '--paginate') return `${files.join('\n')}\n`;
    if (a === 'run' && b === 'list') return JSON.stringify(runs);
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls };
}

const base = (extra) => ({ pr: 12, repo: 'o/r', codeowners: CODEOWNERS, log: () => {}, sleep: async () => {}, ...extra });

describe('CODEOWNERS patterns', () => {
  it('anchors, matches directories and single files', () => {
    assert.ok(codeownersPatternToRegex('/packages/brain-core/').test('packages/brain-core/src/a.ts'));
    assert.equal(codeownersPatternToRegex('/packages/brain-core/').test('packages/brain-core-x/a.ts'), false);
    assert.equal(codeownersPatternToRegex('/packages/brain-core/').test('x/packages/brain-core/a.ts'), false);
    assert.ok(codeownersPatternToRegex('/docs/THREAT-MODEL.md').test('docs/THREAT-MODEL.md'));
    assert.ok(codeownersPatternToRegex('*.pem').test('deep/dir/key.pem'));
    assert.ok(codeownersPatternToRegex('/apps/**/release/').test('apps/emdash-desktop/scripts/release/build.ts'));
  });

  it('reads only the marked security section', () => {
    assert.deepEqual(securityPatterns(CODEOWNERS), [
      '/packages/brain-core/',
      '/.github/',
      '/apps/emdash-desktop/electron-builder.config.ts',
      '/docs/THREAT-MODEL.md',
    ]);
    assert.throws(() => securityPatterns('/a/ @x'), /No patterns/);
  });

  it('the committed CODEOWNERS has a security section covering the gate itself', () => {
    const patterns = securityPatterns(readFileSync(new URL('../../.github/CODEOWNERS', import.meta.url), 'utf8'));
    for (const file of ['.github/workflows/ci.yml', 'tooling/scripts/merge-pr.mjs', 'packages/brain-mcp/src/index.ts', 'docs/THREAT-MODEL.md']) {
      assert.deepEqual(securityFiles([file], patterns), [file], file);
    }
  });
});

describe('mergePr', () => {
  it('merges a green, up-to-date PR pinned to its head commit, then watches main', async () => {
    const { gh, calls } = fakeGh();
    const inherited = [];
    const result = await mergePr(base({ gh, ghInherit: (args) => (inherited.push(args.join(' ')), 0) }));
    assert.deepEqual(result.problems, []);
    assert.equal(result.merged, true);
    assert.equal(result.mergeCommit, MERGE_SHA);
    assert.deepEqual(inherited, [
      `pr merge 12 --repo o/r --squash --match-head-commit ${SHA} --delete-branch`,
      'run watch 7 --repo o/r --exit-status',
    ]);
    assert.ok(calls.some((c) => c.includes(`--commit ${MERGE_SHA}`)));
  });

  it('refuses drafts, closed PRs and bad titles', async () => {
    const { gh } = fakeGh({ view: { isDraft: true, state: 'CLOSED', title: 'Add a grid' } });
    const result = await mergePr(base({ gh, ghInherit: () => assert.fail('must not merge') }));
    assert.equal(result.merged, false);
    assert.equal(result.problems.length, 3);
  });

  it('refuses when ci-ok is not green on the head commit', async () => {
    for (const checkRuns of [[], [{ id: 1, name: 'ci-ok', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } }]]) {
      const { gh } = fakeGh({ checkRuns });
      const result = await mergePr(base({ gh, ghInherit: () => assert.fail('must not merge') }));
      assert.match(result.problems.join('\n'), /ci-ok/);
    }
  });

  it('refuses a branch that is behind its base', async () => {
    const { gh } = fakeGh({ behind: 2 });
    const result = await mergePr(base({ gh, ghInherit: () => assert.fail('must not merge') }));
    assert.match(result.problems[0], /2 commit\(s\) behind main/);
  });

  it('requires security-reviewed when a security path changes, including a rename source', async () => {
    const files = ['docs/guide/x.md', '.github/workflows/ci.yml'];
    const withoutLabel = fakeGh({ files });
    const refused = await mergePr(base({ gh: withoutLabel.gh, ghInherit: () => assert.fail('must not merge') }));
    assert.match(refused.problems[0], /1 security-sensitive file/);

    const withLabel = fakeGh({ files, view: { labels: [{ name: 'security-reviewed' }] } });
    const merged = await mergePr(base({ gh: withLabel.gh, ghInherit: () => 0, watch: false }));
    assert.deepEqual(merged.problems, []);
  });

  it('prints the file list and marks security files', async () => {
    const lines = [];
    const { gh } = fakeGh({ files: ['README.md', 'packages/brain-core/a.ts'] });
    await mergePr(base({ gh, dryRun: true, log: (l) => lines.push(l) }));
    assert.ok(lines.includes('  README.md'));
    assert.ok(lines.includes('  [security] packages/brain-core/a.ts'));
  });

  it('a dry run checks everything and never merges', async () => {
    const { gh } = fakeGh();
    const result = await mergePr(base({ gh, dryRun: true, ghInherit: () => assert.fail('must not merge') }));
    assert.deepEqual(result, { merged: false, problems: [], files: ['docs/guide/x.md'] });
  });

  it('reports red CI on main after the merge', async () => {
    const { gh } = fakeGh();
    const result = await mergePr(base({ gh, ghInherit: (args) => (args[0] === 'run' ? 1 : 0) }));
    assert.equal(result.merged, true);
    assert.match(result.problems[0], /failed after the merge/);
  });

  it('reports when no CI run appears for the merge commit', async () => {
    const { gh } = fakeGh({ runs: [] });
    const result = await mergePr(base({ gh, ghInherit: () => 0, watchAttempts: 2 }));
    assert.match(result.problems[0], /No CI run appeared/);
  });
});

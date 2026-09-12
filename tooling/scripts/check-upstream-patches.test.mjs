// Run: node --test tooling/scripts/check-upstream-patches.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addedLines,
  checkUpstreamPatches,
  expandBraces,
  findUnlogged,
  FORK_BASE,
  tokenNamesFile,
} from './check-upstream-patches.mjs';

const diff = (...added) =>
  ['--- a/docs/UPSTREAM-PATCHES.md', '+++ b/docs/UPSTREAM-PATCHES.md', ...added.map((l) => `+${l}`)].join(
    '\n'
  );

describe('log parsing', () => {
  it('keeps added lines and drops the +++ header and context', () => {
    assert.deepEqual(addedLines('+++ b/x\n+kept\n unchanged\n-removed'), ['kept']);
  });

  it('expands brace lists, including more than one', () => {
    assert.deepEqual(expandBraces('release-{canary,prod}.yml'), ['release-canary.yml', 'release-prod.yml']);
    assert.deepEqual(expandBraces('{a,b}/{c,d}'), ['a/c', 'a/d', 'b/c', 'b/d']);
  });
});

describe('tokenNamesFile', () => {
  it('matches the repo path and the desktop-relative path', () => {
    assert.ok(tokenNamesFile('nx.json', 'nx.json'));
    assert.ok(tokenNamesFile('src/main/lib/telemetry.ts', 'apps/emdash-desktop/src/main/lib/telemetry.ts'));
    assert.ok(tokenNamesFile('.github/workflows/ci.yml', '.github/workflows/ci.yml'));
  });

  it('matches a bare file name and a directory prefix', () => {
    assert.ok(tokenNamesFile('vitest.config.ts', 'apps/emdash-desktop/vitest.config.ts'));
    assert.ok(tokenNamesFile('scripts/release', 'apps/emdash-desktop/scripts/release/build.ts'));
  });

  it('matches elided and glob paths', () => {
    const file = 'apps/emdash-desktop/src/core/features/workbench/browser/sidebar/left-sidebar.tsx';
    assert.ok(tokenNamesFile('src/.../sidebar/left-sidebar.tsx', file));
    assert.ok(tokenNamesFile('src/…/left-sidebar.tsx', file));
    assert.ok(tokenNamesFile('src/core/features/workbench/**', file));
  });

  it('does not match a different file, a partial name or prose', () => {
    assert.equal(tokenNamesFile('src/main/lib/telemetry.ts', 'apps/emdash-desktop/src/main/lib/telemetry.test.ts'), false);
    assert.equal(tokenNamesFile('scripts/rel', 'apps/emdash-desktop/scripts/release/build.ts'), false);
    assert.equal(tokenNamesFile('pnpm run check', 'package.json'), false);
  });
});

describe('findUnlogged', () => {
  const upstreamFiles = new Set(['nx.json', 'package.json', 'apps/emdash-desktop/vitest.config.ts']);

  it('flags an upstream file the added log lines do not name', () => {
    const unlogged = findUnlogged({
      changedFiles: ['nx.json', 'apps/emdash-desktop/vitest.config.ts'],
      upstreamFiles,
      logDiff: diff('| `nx.json` | env input | why |'),
    });
    assert.deepEqual(unlogged, ['apps/emdash-desktop/vitest.config.ts']);
  });

  it('ignores Ninebrains-only files and the log itself', () => {
    const unlogged = findUnlogged({
      changedFiles: ['tooling/scripts/new.mjs', 'docs/UPSTREAM-PATCHES.md'],
      upstreamFiles: new Set([...upstreamFiles, 'docs/UPSTREAM-PATCHES.md']),
      logDiff: '',
    });
    assert.deepEqual(unlogged, []);
  });

  it('only counts added lines: an existing row does not cover a new edit', () => {
    const logDiff = [' | `nx.json` | old row | why |', '-| `package.json` | removed |'].join('\n');
    assert.deepEqual(findUnlogged({ changedFiles: ['nx.json', 'package.json'], upstreamFiles, logDiff }), [
      'nx.json',
      'package.json',
    ]);
  });
});

describe('checkUpstreamPatches', () => {
  it('diffs from the merge base and lists the fork-base tree once', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'merge-base') return 'abc123\n';
      if (args[0] === 'ls-tree') return 'nx.json\npackage.json\n';
      if (args[0] === 'diff' && args[1] === '--name-only') return 'nx.json\npackage.json\nnew.mjs\n';
      return diff('| `package.json` | scripts | why |');
    };
    const result = checkUpstreamPatches({ base: 'origin/main', head: 'HEAD', git });
    assert.deepEqual(result, { mergeBase: 'abc123', unlogged: ['nx.json'] });
    assert.deepEqual(calls, [
      'merge-base origin/main HEAD',
      'diff --name-only --no-renames abc123 HEAD',
      `ls-tree -r --name-only ${FORK_BASE}`,
      'diff abc123 HEAD -- docs/UPSTREAM-PATCHES.md',
    ]);
  });
});

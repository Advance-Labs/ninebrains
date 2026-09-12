// Run: node --test tooling/scripts/vitest-flaky-reporter.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import FlakyRetryReporter, { annotation, escapeCommand, flakyRecord } from './vitest-flaky-reporter.mjs';

const root = '/repo';
const testCase = ({ flaky, retryCount = 1, name = 'menu > opens' } = {}) => ({
  fullName: name,
  module: { moduleId: '/repo/apps/emdash-desktop/src/menu.browser.test.tsx' },
  project: { name: 'browser' },
  diagnostic: () => ({ flaky, retryCount }),
});

describe('flakyRecord', () => {
  it('reports only tests that passed on a retry', () => {
    assert.equal(flakyRecord(testCase({ flaky: false }), root), null);
    assert.equal(flakyRecord({ diagnostic: () => undefined }, root), null);
    assert.deepEqual(flakyRecord(testCase({ flaky: true, retryCount: 1 }), root), {
      file: 'apps/emdash-desktop/src/menu.browser.test.tsx',
      name: 'menu > opens',
      retries: 1,
      project: 'browser',
    });
  });
});

describe('annotation', () => {
  it('is a warning workflow command on the test file', () => {
    const line = annotation(flakyRecord(testCase({ flaky: true }), root));
    assert.match(line, /^::warning file=apps\/emdash-desktop\/src\/menu\.browser\.test\.tsx,title=Flaky test passed on retry::/);
    assert.match(line, /menu > opens failed, then passed after 1 retry \(browser\)/);
  });

  it('escapes newlines, percent signs and property separators', () => {
    assert.equal(escapeCommand('50%\nnext'), '50%25%0Anext');
    assert.equal(escapeCommand('a:b,c', { prop: true }), 'a%3Ab%2Cc');
  });
});

describe('FlakyRetryReporter', () => {
  it('prints one annotation per flaky test and a summary table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
    const summaryFile = join(dir, 'summary.md');
    const out = [];
    const reporter = new FlakyRetryReporter({ root, write: (s) => out.push(s), summaryFile });
    reporter.onTestCaseResult(testCase({ flaky: false }));
    reporter.onTestCaseResult(testCase({ flaky: true, retryCount: 1, name: 'a | b' }));
    reporter.onTestRunEnd();
    assert.equal(out.length, 1);
    const summary = readFileSync(summaryFile, 'utf8');
    assert.match(summary, /1 flaky test\(s\) passed on retry/);
    assert.match(summary, /a \\\| b/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes no summary when nothing was flaky', () => {
    const reporter = new FlakyRetryReporter({ root, write: () => {}, summaryFile: '/nonexistent/dir/summary.md' });
    reporter.onTestRunEnd();
  });
});

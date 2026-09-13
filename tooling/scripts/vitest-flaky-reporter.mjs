/**
 * Vitest reporter for CI retries. The browser test job runs with `--retry 1`; a test that fails
 * and then passes on the retry would otherwise vanish into a green run. This reporter prints a
 * GitHub warning annotation for each one and lists them in the job summary, so a flake stays
 * visible and gets a `flaky-test` issue instead of being forgotten.
 *
 * Use alongside the default reporter:
 *   vitest run --project browser --retry 1 --reporter=default --reporter=<repo>/tooling/scripts/vitest-flaky-reporter.mjs
 *
 * Never use --retry on the node or main-db projects: SEC-* tests must not be retried to green.
 */
import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** Escapes a GitHub workflow-command value (`data`) or property (`prop`). */
export function escapeCommand(text, { prop = false } = {}) {
  let out = String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  if (prop) out = out.replace(/:/g, '%3A').replace(/,/g, '%2C');
  return out;
}

/** The flaky record for a finished test case, or null when it did not pass on a retry. */
export function flakyRecord(testCase, root) {
  const diagnostic = testCase.diagnostic?.();
  if (!diagnostic?.flaky) return null;
  const moduleId = testCase.module?.moduleId ?? '';
  return {
    file: moduleId ? path.relative(root, moduleId).split(path.sep).join('/') : '',
    name: testCase.fullName ?? testCase.name,
    retries: diagnostic.retryCount,
    project: testCase.project?.name ?? '',
  };
}

export function annotation(record) {
  const retries = `${record.retries} ${record.retries === 1 ? 'retry' : 'retries'}`;
  const message = `${record.name} failed, then passed after ${retries}${record.project ? ` (${record.project})` : ''}. Open a flaky-test issue.`;
  return `::warning file=${escapeCommand(record.file, { prop: true })},title=Flaky test passed on retry::${escapeCommand(message)}`;
}

export default class FlakyRetryReporter {
  constructor({ root = process.env.GITHUB_WORKSPACE ?? process.cwd(), write = (s) => process.stdout.write(s), summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
    this.root = root;
    this.write = write;
    this.summaryFile = summaryFile;
    this.flaky = [];
  }

  onTestCaseResult(testCase) {
    const record = flakyRecord(testCase, this.root);
    if (!record) return;
    this.flaky.push(record);
    this.write(`${annotation(record)}\n`);
  }

  onTestRunEnd() {
    if (this.flaky.length === 0 || !this.summaryFile) return;
    const rows = this.flaky.map((r) => `| \`${r.file}\` | ${r.name.replace(/\|/g, '\\|')} | ${r.retries} |`);
    appendFileSync(
      this.summaryFile,
      ['', `### ${this.flaky.length} flaky test(s) passed on retry`, '', '| File | Test | Retries |', '|---|---|---|', ...rows, ''].join('\n')
    );
  }
}

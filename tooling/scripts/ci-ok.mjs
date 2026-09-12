/**
 * The `ci-ok` aggregator in .github/workflows/ci.yml. It is the one status the merge script,
 * the release preflight and (later) branch protection look at, so its rule lives here, tested,
 * instead of in YAML:
 * - every REQUIRED job must be `success`; `skipped` or `cancelled` is a failure;
 * - an OPTIONAL job may be `skipped` (not requested for this event), otherwise it must be
 *   `success` too. A failed optional job fails ci-ok.
 *
 * Usage (from the workflow): RESULTS='${{ toJSON(needs) }}' node tooling/scripts/ci-ok.mjs \
 *   --required static,test-node,test-browser --optional pr-hygiene,e2e
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns one line per failing job; empty when ci-ok is green. */
export function evaluate(needs, { required, optional }) {
  const problems = [];
  for (const job of required) {
    const result = needs[job]?.result ?? 'missing';
    if (result !== 'success') problems.push(`${job}: ${result} (required)`);
  }
  for (const job of optional) {
    const result = needs[job]?.result ?? 'missing';
    if (result !== 'success' && result !== 'skipped') problems.push(`${job}: ${result}`);
  }
  const known = new Set([...required, ...optional]);
  for (const job of Object.keys(needs)) {
    if (!known.has(job)) problems.push(`${job}: not classified as required or optional`);
  }
  return problems;
}

function list(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? [] : argv[index + 1].split(',').filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const needs = JSON.parse(process.env.RESULTS ?? '{}');
  const argv = process.argv.slice(2);
  const problems = evaluate(needs, {
    required: list(argv, '--required'),
    optional: list(argv, '--optional'),
  });
  for (const [job, { result }] of Object.entries(needs)) console.log(`${job}: ${result}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error title=ci-ok::${problem}`);
    process.exit(1);
  }
  console.log('ci-ok: green');
}

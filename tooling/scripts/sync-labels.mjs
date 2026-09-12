/**
 * Creates or updates the labels the CI and merge tooling relies on. Dry run by default: it prints
 * what it would change. `--apply` makes the changes with `gh label create` / `gh label edit`.
 *
 * Usage: pnpm run labels:sync [--apply] [--repo owner/name]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultGh, resolveRepo } from './require-green.mjs';

export const LABELS = [
  { name: 'security', color: 'b60205', description: 'Touches a security-sensitive path (.github/CODEOWNERS)' },
  { name: 'security-reviewed', color: '0e8a16', description: 'Security review done; pnpm run merge requires it on security paths' },
  { name: 'upstream-patch', color: '5319e7', description: 'Edits a file inherited from Emdash (docs/UPSTREAM-PATCHES.md)' },
  { name: 'run-e2e', color: 'fbca04', description: 'Run the Electron e2e job in CI on this PR' },
  { name: 'dependencies', color: '0366d6', description: 'Dependency update' },
  { name: 'release', color: '1d76db', description: 'Release preparation or release tooling' },
  { name: 'flaky-test', color: 'd93f0b', description: 'A test that passed only on a CI retry' },
];

/** [{ action: 'create' | 'update' | 'ok', label }] against the repo's current labels. */
export function planLabels(existing, wanted = LABELS) {
  const byName = new Map(existing.map((label) => [label.name.toLowerCase(), label]));
  return wanted.map((label) => {
    const current = byName.get(label.name.toLowerCase());
    if (!current) return { action: 'create', label };
    const same =
      current.color.toLowerCase() === label.color && (current.description ?? '') === label.description;
    return { action: same ? 'ok' : 'update', label };
  });
}

export function syncLabels({ repo, apply = false, gh = defaultGh, log = console.log }) {
  const existing = JSON.parse(gh(['label', 'list', '--repo', repo, '--limit', '500', '--json', 'name,color,description']));
  const plan = planLabels(existing);
  for (const { action, label } of plan) {
    log(`${apply || action === 'ok' ? '' : 'would '}${action} ${label.name}`);
    if (!apply || action === 'ok') continue;
    const verb = action === 'create' ? 'create' : 'edit';
    gh(['label', verb, label.name, '--repo', repo, '--color', label.color, '--description', label.description]);
  }
  if (!apply && plan.some((step) => step.action !== 'ok')) log('Dry run. Re-run with --apply to change the labels.');
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const repoIndex = argv.indexOf('--repo');
  const repo = repoIndex === -1 ? resolveRepo() : argv[repoIndex + 1];
  syncLabels({ repo, apply: argv.includes('--apply') });
}

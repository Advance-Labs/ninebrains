/**
 * Requires the `ci-ok` check (.github/workflows/ci.yml) to be green on one exact commit. Used by
 * `pnpm run merge <pr>` before merging and by release.yml's preflight before building.
 *
 * Only a completed, successful `ci-ok` check run created by GitHub Actions counts. Any other app
 * posting a check with the same name is ignored.
 *
 * Usage: node tooling/scripts/require-green.mjs <40-hex sha> [--repo owner/name] [--wait]
 *        [--timeout <seconds>]
 * The repo defaults to $GITHUB_REPOSITORY, then to `gh repo view`. Needs `gh` with a token that
 * can read checks (in Actions: `checks: read`).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECK_NAME = 'ci-ok';
export const ACTIONS_APP = 'github-actions';
const FULL_SHA = /^[0-9a-f]{40}$/;

export function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The newest `ci-ok` run from GitHub Actions, or undefined. */
export function latestCheck(checkRuns, name = CHECK_NAME) {
  return checkRuns
    .filter((run) => run.name === name && run.app?.slug === ACTIONS_APP)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)) || b.id - a.id)[0];
}

/** { state: 'green' | 'pending' | 'red' | 'missing', message, url } for one commit. */
export function checkStatus({ repo, sha, gh = defaultGh, name = CHECK_NAME }) {
  if (!FULL_SHA.test(sha)) throw new Error(`Expected a full 40-character commit SHA, got "${sha}"`);
  const response = JSON.parse(
    gh(['api', `repos/${repo}/commits/${sha}/check-runs?check_name=${name}&filter=latest&per_page=100`])
  );
  const run = latestCheck(response.check_runs ?? [], name);
  if (!run) {
    return { state: 'missing', message: `No ${name} check from GitHub Actions on ${sha}.` };
  }
  if (run.status !== 'completed') {
    return { state: 'pending', message: `${name} on ${sha.slice(0, 9)} is ${run.status}.`, url: run.html_url };
  }
  if (run.conclusion !== 'success') {
    return { state: 'red', message: `${name} on ${sha.slice(0, 9)} concluded ${run.conclusion}.`, url: run.html_url };
  }
  return { state: 'green', message: `${name} is green on ${sha.slice(0, 9)}.`, url: run.html_url };
}

/** Polls while the check is missing or pending, up to `timeoutMs`. */
export async function waitForStatus({
  timeoutMs = 60 * 60 * 1000,
  intervalMs = 20_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  ...options
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const status = checkStatus(options);
    if (status.state === 'green' || status.state === 'red' || now() >= deadline) return status;
    await sleep(intervalMs);
  }
}

export function resolveRepo(gh = defaultGh) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
}

function parseArgs(argv) {
  const options = { wait: false, timeoutSeconds: 3600 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--wait') options.wait = true;
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++i]);
    else if (!options.sha) options.sha = arg;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!options.sha) throw new Error('Usage: require-green.mjs <sha> [--repo owner/name] [--wait]');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const repo = options.repo ?? resolveRepo();
  const status = options.wait
    ? await waitForStatus({ repo, sha: options.sha, timeoutMs: options.timeoutSeconds * 1000 })
    : checkStatus({ repo, sha: options.sha });
  const line = `${status.message}${status.url ? ` ${status.url}` : ''}`;
  if (status.state === 'green') {
    console.log(`require-green: ${line}`);
  } else {
    console.error(`::error title=require-green::${line}`);
    process.exit(1);
  }
}

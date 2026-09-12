/**
 * PR hygiene gate (CI job `pr-hygiene`):
 * - DCO: every non-merge commit in base..head carries `Signed-off-by:` with its author's email
 *   (`git commit -s`). Commits already on w7/integrate when the policy started are exempt.
 * - The PR title is a Conventional Commit (`feat(lanes): …`), because it becomes the squash
 *   commit on main and feeds the changelog.
 *
 * Usage: node tooling/scripts/pr-hygiene.mjs --base <sha> --head <sha> [--title "<title>"]
 * The title can also come from PR_TITLE. With neither, only the DCO check runs.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Tip of w7/integrate when DCO became required. Its ancestors predate the policy. */
export const DCO_CUTOFF = '4330fed1e50f629fedb9d2ddc79c292ee18454a1';

export const COMMIT_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];

const TITLE_PATTERN = new RegExp(`^(${COMMIT_TYPES.join('|')})(\\([\\w./, -]+\\))?!?: \\S`);

/** An error message for a non-conventional title, or null. */
export function checkTitle(title) {
  if (TITLE_PATTERN.test(title ?? '')) return null;
  return (
    `PR title "${title}" is not a Conventional Commit. Use "<type>(<scope>): <summary>" with a ` +
    `type from: ${COMMIT_TYPES.join(', ')}. Example: "fix(gates): name the SEC-30 setup failure".`
  );
}

const FIELD = '\x1f';
const RECORD = '\x1e';
export const LOG_FORMAT = `%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%B${RECORD}`;

export function parseCommits(logText) {
  return logText
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, parents, name, email, body = ''] = record.split(FIELD);
      return { sha, parents: parents.split(' ').filter(Boolean), name, email, body };
    });
}

/**
 * GitHub App bots (Dependabot) cannot sign the DCO; a human still reviews and merges their PRs.
 * Only GitHub's own `<id>+<name>[bot]@users.noreply.github.com` addresses count.
 */
export function isBotAuthor(commit) {
  return /^\d+\+[\w-]+\[bot\]@users\.noreply\.github\.com$/i.test(commit.email);
}

/** Commits that fail DCO. `isExempt(sha)` marks commits that predate the policy. */
export function dcoProblems(commits, { isExempt = () => false } = {}) {
  const problems = [];
  for (const commit of commits) {
    if (commit.parents.length > 1 || isBotAuthor(commit) || isExempt(commit.sha)) continue;
    const signoffs = [...commit.body.matchAll(/^Signed-off-by: .+ <([^>]+)>\s*$/gim)].map((m) => m[1]);
    if (signoffs.length === 0) {
      problems.push({ sha: commit.sha, reason: 'no Signed-off-by trailer' });
    } else if (!signoffs.some((email) => email.toLowerCase() === commit.email.toLowerCase())) {
      problems.push({
        sha: commit.sha,
        reason: `Signed-off-by does not match the author email <${commit.email}>`,
      });
    }
  }
  return problems;
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function checkPrHygiene({ base, head, title, git = defaultGit }) {
  const commits = parseCommits(git(['log', `--format=${LOG_FORMAT}`, `${base}..${head}`]));
  const isExempt = (sha) => {
    try {
      git(['merge-base', '--is-ancestor', sha, DCO_CUTOFF]);
      return true;
    } catch {
      return false;
    }
  };
  return {
    commits: commits.length,
    dco: dcoProblems(commits, { isExempt }),
    title: title === undefined ? null : checkTitle(title),
  };
}

function parseArgs(argv) {
  const options = { title: process.env.PR_TITLE || undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--head') options.head = argv[++i];
    else if (argv[i] === '--title') options.title = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!options.base || !options.head) throw new Error('Usage: pr-hygiene.mjs --base <sha> --head <sha>');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPrHygiene(parseArgs(process.argv.slice(2)));
  let failed = false;
  for (const problem of result.dco) {
    failed = true;
    console.error(`::error title=DCO::${problem.sha.slice(0, 9)}: ${problem.reason}`);
  }
  if (result.dco.length > 0) {
    console.error(
      'Sign off each commit: `git commit -s` for new ones, or ' +
        '`git rebase --signoff <base>` to add it to existing ones, then force-push.'
    );
  }
  if (result.title) {
    failed = true;
    console.error(`::error title=PR title::${result.title}`);
  }
  console.log(
    `pr-hygiene: ${result.commits} commit(s) checked for DCO; ` +
      `title ${result.title === null ? 'ok or not checked' : 'invalid'}.`
  );
  process.exit(failed ? 1 : 0);
}

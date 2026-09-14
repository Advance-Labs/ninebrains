/**
 * Verified-bot PR exemption for the upstream-patch log gate (tooling/scripts/check-upstream-patches.mjs).
 *
 * Dependabot PRs that bump action pins in inherited workflows always fail that gate: a bot cannot
 * write the docs/UPSTREAM-PATCHES.md row. This exempts a PR only when every field that would prove
 * it is genuinely GitHub-authored checks out. A prior attempt exempted by git author email, which
 * is self-asserted (`git commit --author="x <1+evil[bot]@users.noreply.github.com>"`) and missed
 * human edits inside a merge commit. Every check here instead reads fields GitHub itself sets on
 * the PR and commit objects, which a PR author cannot set:
 *
 * - `pr.user.login`/`type`: who opened the PR, per GitHub's own account records.
 * - `commit.author.login`: GitHub's resolution of the commit's author to an account, not the
 *   free-text `git log` author name/email a push can put anything into.
 * - `commit.commit.verification.verified`: the commit's GPG/SSH signature actually checks out
 *   against a key GitHub holds for that signer. A spoofed author cannot forge this.
 * - `commit.committer.login === 'web-flow'`: GitHub's own identity for commits it creates via the
 *   API (Dependabot's included) — never an identity a human push can claim.
 * - single-parent commits only: a merge could fold in a human commit GitHub never touched.
 *
 * On PR #3 (a real Dependabot actions-bump PR), `gh api repos/Advance-Labs/ninebrains/pulls/3/commits`
 * showed exactly this shape: verification.verified === true, committer.login === 'web-flow', one
 * parent. That is what this rule checks.
 *
 * Usage: node tooling/scripts/bot-pr.mjs --repo <owner/name> --pr <n>
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BOT_LOGIN = 'dependabot[bot]';

/**
 * Pure verdict: is this PR exempt from the upstream-patch log gate?
 * `pr` and `commits` are shaped like the GitHub REST API's
 * `GET /repos/{o}/{r}/pulls/{n}` and `GET /repos/{o}/{r}/pulls/{n}/commits`.
 */
export function verifiedBotPr(pr, commits, { botLogin = DEFAULT_BOT_LOGIN } = {}) {
  const reasons = [];

  if (pr?.user?.login !== botLogin) {
    reasons.push(`PR was opened by "${pr?.user?.login ?? 'unknown'}", not ${botLogin}`);
  } else if (pr?.user?.type !== 'Bot') {
    reasons.push(`PR author "${botLogin}" has type "${pr?.user?.type ?? 'unknown'}", not "Bot"`);
  }

  if (!Array.isArray(commits) || commits.length === 0) {
    reasons.push('PR has no commits');
  } else {
    commits.forEach((commit, index) => {
      const label = `commit ${index + 1}/${commits.length} (${commit?.sha?.slice(0, 9) ?? 'unknown sha'})`;

      if (commit?.author?.login !== botLogin) {
        reasons.push(`${label}: author.login is "${commit?.author?.login ?? 'unknown'}", not ${botLogin}`);
      }

      if (commit?.commit?.verification?.verified !== true) {
        reasons.push(`${label}: commit is not verified`);
      }

      if (commit?.committer?.login !== 'web-flow') {
        reasons.push(`${label}: committer.login is "${commit?.committer?.login ?? 'unknown'}", not web-flow`);
      }

      const parents = commit?.parents;
      if (!Array.isArray(parents) || parents.length !== 1) {
        reasons.push(`${label}: has ${Array.isArray(parents) ? parents.length : 'unknown'} parent(s), not 1`);
      }
    });
  }

  return { exempt: reasons.length === 0, reasons };
}

function defaultGhApi(args) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Fetches the PR and its commits from the GitHub API and applies verifiedBotPr. */
export function checkBotPr({ repo, pr, botLogin = DEFAULT_BOT_LOGIN, ghApi = defaultGhApi }) {
  const prData = JSON.parse(ghApi([`repos/${repo}/pulls/${pr}`]));
  const commitsText = ghApi([`repos/${repo}/pulls/${pr}/commits`, '--paginate', '--slurp']);
  const commits = flattenPaginated(commitsText);
  return verifiedBotPr(prData, commits, { botLogin });
}

/** `gh api --paginate --slurp` wraps each page's array as one element of an outer array. */
function flattenPaginated(text) {
  const pages = JSON.parse(text);
  return Array.isArray(pages) && Array.isArray(pages[0]) ? pages.flat() : pages;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--pr') options.pr = argv[++i];
    else if (argv[i] === '--bot-login') options.botLogin = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!options.repo || !options.pr) throw new Error('Usage: bot-pr.mjs --repo <owner/name> --pr <n>');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { repo, pr, botLogin } = parseArgs(process.argv.slice(2));
    const { exempt, reasons } = checkBotPr({ repo, pr, botLogin });
    console.log(exempt ? 'exempt' : `not-exempt: ${reasons.join('; ')}`);
    process.exit(0);
  } catch (error) {
    console.error(`bot-pr: ${error.message}`);
    process.exit(1);
  }
}

/**
 * The merge path for Ninebrains (`pnpm run merge <pr>`). Branch protection is not available on
 * this private free-plan repo, so this script is where the merge rules live:
 * - the PR is open and not a draft, and its title is a Conventional Commit;
 * - `ci-ok` is green on the PR's exact head commit (require-green.mjs);
 * - the branch is 0 commits behind its base, so what CI tested is what lands;
 * - a PR touching a security-sensitive path (the marked section of .github/CODEOWNERS) carries
 *   the `security-reviewed` label;
 * then it prints the file list, squash-merges pinned to that head commit (`--match-head-commit`,
 * so a push after the check cannot slip in), deletes the branch and watches CI on the base.
 *
 * Usage: pnpm run merge <pr> [--dry-run] [--no-watch] [--repo owner/name]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTitle } from './pr-hygiene.mjs';
import { checkStatus, defaultGh, resolveRepo } from './require-green.mjs';

export const SECURITY_LABEL = 'security-reviewed';
export const SECURITY_BEGIN = '# BEGIN security-sensitive';
export const SECURITY_END = '# END security-sensitive';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A CODEOWNERS (gitignore-style) pattern as a regex over repo-relative paths. */
export function codeownersPatternToRegex(pattern) {
  let p = pattern.trim();
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  p = p.replace(/^\//, '');
  const dirOnly = p.endsWith('/');
  p = p.replace(/\/$/, '');
  let source = '';
  for (let i = 0; i < p.length; ) {
    if (p.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 3;
    } else if (p.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (p[i] === '*') {
      source += '[^/]*';
      i += 1;
    } else if (p[i] === '?') {
      source += '[^/]';
      i += 1;
    } else {
      source += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`${anchored ? '^' : '^(?:.*/)?'}${source}${dirOnly ? '/.*' : '(?:/.*)?'}$`);
}

/** Patterns between the security markers of a CODEOWNERS file. */
export function securityPatterns(codeowners) {
  const patterns = [];
  let inside = false;
  for (const raw of codeowners.split('\n')) {
    const line = raw.trim();
    if (line === SECURITY_BEGIN) inside = true;
    else if (line === SECURITY_END) inside = false;
    else if (inside && line && !line.startsWith('#')) patterns.push(line.split(/\s+/)[0]);
  }
  if (patterns.length === 0) throw new Error(`No patterns between "${SECURITY_BEGIN}" and "${SECURITY_END}"`);
  return patterns;
}

export function securityFiles(files, patterns) {
  const regexes = patterns.map(codeownersPatternToRegex);
  return files.filter((file) => regexes.some((re) => re.test(file)));
}

function json(gh, args) {
  return JSON.parse(gh(args));
}

/**
 * Checks every rule and, unless `dryRun`, merges. Returns { merged, problems, files, mergeCommit }.
 * `gh(args)` returns stdout; `ghInherit(args)` runs with the terminal attached and returns the exit code.
 */
export async function mergePr({
  pr,
  repo,
  gh = defaultGh,
  ghInherit = (args) => spawnSync('gh', args, { stdio: 'inherit' }).status ?? 1,
  codeowners = readFileSync(path.join(REPO_ROOT, '.github/CODEOWNERS'), 'utf8'),
  dryRun = false,
  watch = true,
  log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  watchAttempts = 30,
}) {
  const view = json(gh, [
    'pr', 'view', String(pr), '--repo', repo,
    '--json', 'number,title,url,state,isDraft,headRefOid,headRefName,baseRefName,labels',
  ]);
  const problems = [];
  if (view.state !== 'OPEN') problems.push(`PR #${view.number} is ${view.state}, not OPEN.`);
  if (view.isDraft) problems.push(`PR #${view.number} is a draft. Mark it ready for review first.`);
  const titleProblem = checkTitle(view.title);
  if (titleProblem) problems.push(titleProblem);

  const sha = view.headRefOid;
  const green = checkStatus({ repo, sha, gh });
  if (green.state !== 'green') problems.push(`${green.message}${green.url ? ` ${green.url}` : ''}`);

  const behind = Number(
    gh(['api', `repos/${repo}/compare/${view.baseRefName}...${sha}`, '--jq', '.behind_by']).trim()
  );
  if (behind !== 0) {
    problems.push(
      `${view.headRefName} is ${behind} commit(s) behind ${view.baseRefName}. Update it ` +
        `(gh pr update-branch ${view.number} --rebase) and let CI go green on the new head.`
    );
  }

  const files = gh([
    'api', '--paginate', `repos/${repo}/pulls/${view.number}/files?per_page=100`,
    '--jq', '.[] | .filename, (.previous_filename // empty)',
  ])
    .split('\n')
    .filter(Boolean);
  const sensitive = new Set(securityFiles(files, securityPatterns(codeowners)));
  const labels = view.labels.map((label) => label.name);
  if (sensitive.size > 0 && !labels.includes(SECURITY_LABEL)) {
    problems.push(
      `${sensitive.size} security-sensitive file(s) changed and the PR has no "${SECURITY_LABEL}" ` +
        `label. Get the security review, then add the label.`
    );
  }

  log(`PR #${view.number}: ${view.title}\n${view.url}\nhead ${sha} -> ${view.baseRefName}\n`);
  log(`${files.length} file(s):`);
  for (const file of files) log(`  ${sensitive.has(file) ? '[security] ' : ''}${file}`);

  if (problems.length > 0) {
    log('\nNot merging:');
    for (const problem of problems) log(`  - ${problem}`);
    return { merged: false, problems, files };
  }
  if (dryRun) {
    log('\nDry run: every rule passes. Not merging.');
    return { merged: false, problems, files };
  }

  const code = ghInherit([
    'pr', 'merge', String(view.number), '--repo', repo,
    '--squash', '--match-head-commit', sha, '--delete-branch',
  ]);
  if (code !== 0) {
    return { merged: false, problems: [`gh pr merge exited ${code}`], files };
  }
  const mergeCommit = gh([
    'pr', 'view', String(view.number), '--repo', repo, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid',
  ]).trim();
  log(`\nMerged as ${mergeCommit}.`);
  if (!watch) return { merged: true, problems, files, mergeCommit };

  log(`Waiting for CI on ${view.baseRefName} at ${mergeCommit.slice(0, 9)}...`);
  for (let attempt = 0; attempt < watchAttempts; attempt++) {
    const runs = json(gh, [
      'run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--branch', view.baseRefName,
      '--event', 'push', '--commit', mergeCommit, '--json', 'databaseId,url',
    ]);
    if (runs.length > 0) {
      log(runs[0].url);
      const watchCode = ghInherit(['run', 'watch', String(runs[0].databaseId), '--repo', repo, '--exit-status']);
      if (watchCode !== 0) {
        return {
          merged: true,
          mergeCommit,
          files,
          problems: [`CI on ${view.baseRefName} failed after the merge: ${runs[0].url}. Fix forward or revert.`],
        };
      }
      return { merged: true, problems, files, mergeCommit };
    }
    await sleep(10_000);
  }
  return {
    merged: true,
    mergeCommit,
    files,
    problems: [`No CI run appeared for ${mergeCommit} on ${view.baseRefName}. Check the Actions tab.`],
  };
}

function parseArgs(argv) {
  const options = { dryRun: false, watch: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-watch') options.watch = false;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (/^\d+$/.test(arg) && !options.pr) options.pr = Number(arg);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!options.pr) throw new Error('Usage: pnpm run merge <pr> [--dry-run] [--no-watch]');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = await mergePr({ ...options, repo: options.repo ?? resolveRepo() });
  if (result.problems.length > 0 && result.merged) {
    for (const problem of result.problems) console.error(problem);
  }
  process.exit(result.problems.length > 0 ? 1 : 0);
}

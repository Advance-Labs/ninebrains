/**
 * Local pre-push guard (tooling/git-hooks/pre-push; install once with `pnpm run hooks:install`).
 *
 * 1. Refuses any push to refs/heads/main. Changes reach main through `pnpm run merge <pr>`, which
 *    merges on GitHub. The one deliberate override is NINEBRAINS_MERGE_GUARD=<the exact sha being
 *    pushed>, for a documented emergency such as a release rollback (docs/RELEASING.md).
 * 2. Runs what CI's static and test jobs would catch first: format:check, `nx affected` lint,
 *    typecheck and test against origin/main, and the upstream-patch log check.
 *
 * `git push --no-verify` skips all of it. CI still runs everything; this only saves a round trip.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZERO_SHA = '0'.repeat(40);
export const PROTECTED_REFS = ['refs/heads/main'];

/** Git feeds one line per ref: `<local ref> <local sha> <remote ref> <remote sha>`. */
export function parsePushLines(stdin) {
  return stdin
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** Messages for pushes to a protected ref that the merge guard does not cover. */
export function protectedRefProblems(updates, env = process.env) {
  const problems = [];
  for (const update of updates) {
    if (!PROTECTED_REFS.includes(update.remoteRef)) continue;
    if (update.localSha === ZERO_SHA) {
      problems.push(`Refusing to delete ${update.remoteRef}.`);
    } else if (env.NINEBRAINS_MERGE_GUARD !== update.localSha) {
      problems.push(
        `Refusing to push to ${update.remoteRef}. Open a PR and run \`pnpm run merge <pr>\`. ` +
          `For a documented emergency only: NINEBRAINS_MERGE_GUARD=${update.localSha} git push ...`
      );
    }
  }
  return problems;
}

/**
 * Git exports these to every hook (`git rev-parse --local-env-vars`). A child that inherits them
 * points every `git` it runs at the repo being pushed, whatever its cwd: test fixtures that
 * `git init` and `git commit` in a temp dir then rewrite this repo instead. On 2026-09-13 that set
 * `core.bare=true` and a Test identity on the shared .git and stacked commits on the pushed branch.
 */
export const GIT_REPO_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
];

/** The environment the checks run in: the hook's own, minus the variables that locate a repo. */
export function checkEnv(env = process.env) {
  const clean = { ...env };
  for (const name of GIT_REPO_ENV) delete clean[name];
  for (const name of Object.keys(clean)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete clean[name];
  return clean;
}

/** The commands to run for a push, or [] when it only deletes refs. */
export function checkCommands(updates, base) {
  if (!updates.some((update) => update.localSha !== ZERO_SHA)) return [];
  return [
    ['pnpm', ['run', 'format:check']],
    ['pnpm', ['exec', 'nx', 'affected', '-t', 'lint', 'typecheck', 'test', `--base=${base}`, '--head=HEAD']],
    ['node', ['tooling/scripts/check-upstream-patches.mjs', '--base', base, '--head', 'HEAD']],
  ];
}

export function runPrePush({
  stdin,
  env = process.env,
  run = (cmd, args, childEnv) =>
    spawnSync(cmd, args, { stdio: 'inherit', env: childEnv, shell: process.platform === 'win32' }).status,
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
  log = console.error,
}) {
  const updates = parsePushLines(stdin);
  const problems = protectedRefProblems(updates, env);
  if (problems.length > 0) {
    for (const problem of problems) log(`pre-push: ${problem}`);
    return 1;
  }
  let base = 'origin/main';
  try {
    git(['rev-parse', '--verify', '--quiet', base]);
  } catch {
    base = 'main';
  }
  const commands = checkCommands(updates, base);
  if (commands.length > 0 && git(['status', '--porcelain']).trim()) {
    log('pre-push: warning: uncommitted changes are in the working tree, and the checks see them.');
  }
  // The Playwright browser projects are skipped here (apps/emdash-desktop/vitest.config.ts reads
  // EMDASH_TEST_SKIP_BROWSER): under a full local `nx affected` run they time out on load, not on
  // bugs, and block the push. CI's test-browser job still runs them on every PR.
  // `EMDASH_TEST_BROWSER=1 git push` forces them back on.
  const childEnv = { ...checkEnv(env), EMDASH_TEST_SKIP_BROWSER: '1' };
  for (const [cmd, args] of commands) {
    log(`\npre-push: ${cmd} ${args.join(' ')}`);
    const status = run(cmd, args, childEnv);
    if (status !== 0) {
      log(`\npre-push: failed at "${cmd} ${args.join(' ')}". Fix it, or push with --no-verify (CI will still run it).`);
      return typeof status === 'number' ? status : 1;
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runPrePush({ stdin: readFileSync(0, 'utf8') }));
}

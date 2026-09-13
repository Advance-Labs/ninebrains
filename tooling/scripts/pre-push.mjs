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
  run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status,
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
  for (const [cmd, args] of commands) {
    log(`\npre-push: ${cmd} ${args.join(' ')}`);
    const status = run(cmd, args);
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

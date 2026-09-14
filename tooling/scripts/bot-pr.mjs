/**
 * Verified-bot PR exemption for the upstream-patch log gate (tooling/scripts/check-upstream-patches.mjs).
 *
 * Dependabot PRs that bump action pins in inherited workflows always fail that gate: a bot cannot
 * write the docs/UPSTREAM-PATCHES.md row. Two earlier designs tried to prove the PR was genuinely
 * Dependabot's from commit metadata and both were forgeable:
 * - by the free-text git author (`git commit --author="x <1+evil[bot]@users.noreply.github.com>"`);
 * - by the commit's resolved `author.login`, GitHub's `verified` signature, and its `web-flow`
 *   committer. Anyone with write access can push a commit through GitHub's Contents/Git Data API
 *   with `author.email` set to Dependabot's public noreply address; GitHub signs that commit
 *   itself, so it gets `author.login: dependabot[bot]`, `committer.login: web-flow` and
 *   `verified: true`, indistinguishable from a real Dependabot commit. The commits endpoint also
 *   caps at 250 rows, so a check that iterates it can be fooled by padding past the cap.
 *
 * Per-commit metadata is therefore never trusted. The only unforgeable fact is who opened the PR
 * (`pr.user`, set once by GitHub when the PR is created and not a field a commit push can touch).
 * That alone is not enough — a compromised or careless push to Dependabot's branch would inherit
 * it — so the exemption ALSO requires that the diff itself (computed locally with `git diff`, not
 * read from the API) has the shape only a pin bump can have: it touches only workflow/composite-
 * action YAML, and every added or removed line is a bare `uses: owner/repo[/path]@ref` pin, with
 * no added/deleted/renamed/mode-changed/binary files. A forged commit on the bot's branch can then
 * only ever move action pins — it cannot add a `run:` step, change a permission, or touch any
 * other line — so a human still reviews and merges every PR as usual. The diff shape is the
 * guarantee here, not the commit metadata.
 *
 * Usage: node tooling/scripts/bot-pr.mjs --repo <owner/name> --pr <n> --base <sha> --head <sha>
 * `--base`/`--head` are the PR's base and head SHAs (ci.yml already has both, for the
 * upstream-patch check); the diff is `git diff --no-renames --unified=0 <merge-base> <head>`, the
 * same range check-upstream-patches.mjs uses.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BOT_LOGIN = 'dependabot[bot]';

/** `.github/workflows/*.{yml,yaml}` or `.github/actions/**\/action.{yml,yaml}`. */
const ALLOWED_FILE_RE = /^(?:\.github\/workflows\/[^/]+\.ya?ml|\.github\/actions\/.+\/action\.ya?ml)$/;

/**
 * A changed line that is nothing but an action pin: an optional YAML list marker, `uses: `, an
 * `owner/repo[/path]@ref`, and an optional trailing `# comment` (how these pins carry the human-
 * readable tag next to a SHA, e.g. `# v4.4.0`). Anchored full-line so nothing else can ride along.
 */
export const PIN_LINE_RE = /^(?:- )?uses: [\w.-]+\/[\w.-]+(?:\/[\w./-]+)*@[\w.-]+(?:\s+#.*)?$/;

/** Only the PR's own `user`, set by GitHub when the PR was opened, cannot be forged by a push. */
export function prAuthorIsBot(pr, { botLogin = DEFAULT_BOT_LOGIN } = {}) {
  if (pr?.user?.login !== botLogin) {
    return { ok: false, reason: `PR was opened by "${pr?.user?.login ?? 'unknown'}", not ${botLogin}` };
  }
  if (pr?.user?.type !== 'Bot') {
    return { ok: false, reason: `PR author "${botLogin}" has type "${pr?.user?.type ?? 'unknown'}", not "Bot"` };
  }
  return { ok: true, reason: null };
}

/** Split a `git diff --no-renames` into its per-file `diff --git a/x b/y` blocks. */
function diffBlocks(diffText) {
  return (diffText ?? '')
    .split(/^(?=diff --git )/m)
    .map((block) => block.trimEnd())
    .filter(Boolean);
}

/**
 * True when `diffText` (a `git diff --no-renames --unified=0 <merge-base> <head>`) touches only
 * workflow/composite-action YAML and every changed line is a bare action-pin bump. Fails closed:
 * an empty diff, a non-matching file, an added/deleted/renamed/mode-changed/binary file, or any
 * changed line that is not exactly a pin all count as reasons, not silent passes.
 */
export function pinOnlyDiff(diffText) {
  const reasons = [];
  const blocks = diffBlocks(diffText);
  if (blocks.length === 0) return { ok: false, reasons: ['diff is empty'] };

  for (const block of blocks) {
    const lines = block.split('\n');
    const header = lines[0].match(/^diff --git a\/(\S+) b\/(\S+)/);
    const file = header ? header[2] : '(unparseable diff header)';

    if (/^(?:new|deleted) file mode \d+$/m.test(block)) {
      reasons.push(`${file}: adds or deletes a file`);
      continue;
    }
    if (/^(?:old|new) mode \d+$/m.test(block)) {
      reasons.push(`${file}: changes a file's mode`);
      continue;
    }
    if (/^rename (?:from|to) /m.test(block)) {
      reasons.push(`${file}: renames a file`);
      continue;
    }
    if (/^Binary files |^GIT binary patch$/m.test(block)) {
      reasons.push(`${file}: binary file change`);
      continue;
    }
    if (!ALLOWED_FILE_RE.test(file)) {
      reasons.push(`${file}: not a workflow or composite-action file`);
      continue;
    }

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (!line.startsWith('+') && !line.startsWith('-')) continue;
      const content = line.slice(1).trim();
      if (!PIN_LINE_RE.test(content)) {
        reasons.push(`${file}: changed line is not a bare action pin: "${content}"`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** The full exemption verdict: the PR author, from the API, AND the diff shape, from local git. */
export function verifiedBotPr({ pr, diffText, botLogin = DEFAULT_BOT_LOGIN } = {}) {
  const reasons = [];

  const author = prAuthorIsBot(pr, { botLogin });
  if (!author.ok) reasons.push(author.reason);

  const diff = pinOnlyDiff(diffText);
  if (!diff.ok) reasons.push(...diff.reasons);

  return { exempt: reasons.length === 0, reasons };
}

function defaultGhApi(args) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Fetches the PR from the API and the diff from local git, then applies verifiedBotPr. */
export function checkBotPr({ repo, pr, base, head, botLogin = DEFAULT_BOT_LOGIN, ghApi = defaultGhApi, git = defaultGit }) {
  const prData = JSON.parse(ghApi([`repos/${repo}/pulls/${pr}`]));
  const mergeBase = git(['merge-base', base, head]).trim();
  const diffText = git(['diff', '--no-renames', '--unified=0', mergeBase, head]);
  return verifiedBotPr({ pr: prData, diffText, botLogin });
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') options.repo = argv[++i];
    else if (argv[i] === '--pr') options.pr = argv[++i];
    else if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--head') options.head = argv[++i];
    else if (argv[i] === '--bot-login') options.botLogin = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!options.repo || !options.pr || !options.base || !options.head) {
    throw new Error('Usage: bot-pr.mjs --repo <owner/name> --pr <n> --base <sha> --head <sha>');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { repo, pr, base, head, botLogin } = parseArgs(process.argv.slice(2));
    const { exempt, reasons } = checkBotPr({ repo, pr, base, head, botLogin });
    console.log(exempt ? 'exempt' : `not-exempt: ${reasons.join('; ')}`);
    process.exit(0);
  } catch (error) {
    console.error(`bot-pr: ${error.message}`);
    process.exit(1);
  }
}

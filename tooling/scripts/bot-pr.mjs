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
 * read from the API) has the shape only a pin bump can have. What is actually guaranteed, and
 * nothing more: the diff touches only workflow/composite-action YAML, and every hunk is an
 * equal-count, line-for-line swap of `uses:` pins where each removed/added pair keeps the same
 * indentation, the same optional `- ` list marker and the same `owner/repo[/path]` — only the
 * `@ref` and the trailing `# comment` may differ, in place. A step cannot be moved to a new
 * indent or a new job, an action cannot be swapped for a different one, and no line can be added
 * or removed on its own (uneven counts fail the whole hunk); no added/deleted/renamed/mode-changed/
 * binary files are allowed either. A forged commit on the bot's branch can then only ever retarget
 * an existing pin to a different ref — it cannot add a `run:` step, change a permission, move a
 * step, or touch any other line — so a human still reviews and merges every PR as usual. The diff
 * shape is the guarantee here, not the commit metadata.
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
 * One pin line, matched WITHOUT trimming: captures its leading whitespace, its optional YAML list
 * marker, the `owner/repo[/path]` it names, the `@ref`, and any trailing `# comment` (how these
 * pins carry a human-readable tag next to a SHA, e.g. `# v4.4.0`). A pair check (below) requires
 * the first three captures to be byte-identical between the removed and added line of a swap, so
 * only the ref and the comment are free to change. Anchored full-line so nothing else can ride
 * along.
 */
export const PIN_LINE_RE = /^(\s*)(- )?uses: ([\w.-]+\/[\w.-]+(?:\/[\w./-]+)*)@([\w.-]+)(\s+#.*)?$/;

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
 * Splits one file's diff lines into hunks (delimited by `@@ ... @@`, since `--unified=0` means a
 * hunk holds only changed lines, no context), each with its removed (`-`) and added (`+`) lines in
 * order, prefix stripped, otherwise untouched (no trimming — indentation is part of what a pair
 * check below compares).
 */
function parseHunks(lines) {
  const hunks = [];
  let current = null;
  for (const line of lines) {
    // The `--- a/…` and `+++ b/…` file headers come before the first `@@`, while `current` is still
    // null, so nothing inside a hunk is excluded by prefix: a content line that itself starts with
    // `--` or `++` must be counted and checked, not skipped.
    if (line.startsWith('@@')) {
      current = { removed: [], added: [] };
      hunks.push(current);
    } else if (current && line.startsWith('-')) {
      current.removed.push(line.slice(1));
    } else if (current && line.startsWith('+')) {
      current.added.push(line.slice(1));
    }
  }
  return hunks;
}

/**
 * A hunk counts as a pin-for-pin swap only if it has equal, non-zero counts of removed and added
 * lines, and each removed/added pair (matched positionally, in order) is the same pin line except
 * for its `@ref` and trailing comment. Anything else — uneven counts, a non-pin line, a moved
 * indent, a swapped list marker, or a different `owner/repo[/path]` — is a reason to reject.
 */
function checkHunk(hunk, file) {
  const { removed, added } = hunk;
  if (removed.length !== added.length || removed.length === 0) {
    return [
      `${file}: hunk has ${removed.length} removed and ${added.length} added line(s), not an ` +
        'equal, non-zero pin-for-pin swap',
    ];
  }

  const reasons = [];
  for (let i = 0; i < removed.length; i++) {
    const rm = PIN_LINE_RE.exec(removed[i]);
    const am = PIN_LINE_RE.exec(added[i]);
    if (!rm) {
      reasons.push(`${file}: removed line is not a bare action pin: "${removed[i]}"`);
      continue;
    }
    if (!am) {
      reasons.push(`${file}: added line is not a bare action pin: "${added[i]}"`);
      continue;
    }
    const [, rmIndent, rmDash, rmPath] = rm;
    const [, amIndent, amDash, amPath] = am;
    if (rmIndent !== amIndent) {
      reasons.push(`${file}: pin's indentation changed ("${rmIndent}" -> "${amIndent}")`);
    }
    if ((rmDash ?? '') !== (amDash ?? '')) {
      reasons.push(`${file}: pin's list marker changed`);
    }
    if (rmPath !== amPath) {
      reasons.push(`${file}: action changed ("${rmPath}" -> "${amPath}")`);
    }
  }
  return reasons;
}

/**
 * True when `diffText` (a `git diff --no-renames --unified=0 <merge-base> <head>`) touches only
 * workflow/composite-action YAML and every hunk is a pin-for-pin swap (see checkHunk). Fails
 * closed: an empty diff, a non-matching file, an added/deleted/renamed/mode-changed/binary file, a
 * hunk with no changed pin, or any hunk that is not exactly an equal-count ref/comment-only swap
 * all count as reasons, not silent passes.
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
    // Defensive only: `git diff --no-renames` (what checkBotPr always passes) never emits these —
    // a rename shows as a paired delete + add instead, caught by the file-mode check above. Kept
    // in case pinOnlyDiff is ever called on a diff computed without that flag.
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

    const hunks = parseHunks(lines);
    if (hunks.length === 0) {
      reasons.push(`${file}: has no hunks to check`);
      continue;
    }
    for (const hunk of hunks) reasons.push(...checkHunk(hunk, file));
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

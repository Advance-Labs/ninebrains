/**
 * Upstream-patch log gate. Every file a branch changes that already existed at the fork base
 * (`dbf690c`, generalaction/emdash) must be named in the lines the branch adds to
 * docs/UPSTREAM-PATCHES.md. That log is what keeps an upstream rebase cheap, so an unlogged edit
 * to an inherited file fails CI (pr-hygiene) and the local pre-push hook.
 *
 * A file counts as named when a backtick code span on an added line of the log diff matches it:
 * the repo path, the path relative to apps/emdash-desktop/ (the log's default), a bare file name,
 * a brace list (`release-{canary,prod}.yml`), or an elided path (`src/.../left-sidebar.tsx`,
 * `scripts/release/**`).
 *
 * Usage: node tooling/scripts/check-upstream-patches.mjs [--base origin/main] [--head HEAD]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORK_BASE = 'dbf690c';
export const PATCH_LOG = 'docs/UPSTREAM-PATCHES.md';
const DESKTOP_PREFIX = 'apps/emdash-desktop/';

/** The `+` lines of a unified diff, without the `+++` file header. */
export function addedLines(diffText) {
  return diffText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

/** Contents of every `code span` in the given lines. */
export function codeSpans(lines) {
  const spans = [];
  for (const line of lines) {
    for (const match of line.matchAll(/`([^`]+)`/g)) spans.push(match[1].trim());
  }
  return spans;
}

/** `a-{b,c}.ts` → [`a-b.ts`, `a-c.ts`]; nested and repeated lists expand fully. */
export function expandBraces(token) {
  const match = token.match(/\{([^{}]*)\}/);
  if (!match) return [token];
  const [whole, body] = match;
  const before = token.slice(0, match.index);
  const after = token.slice(match.index + whole.length);
  return body.split(',').flatMap((part) => expandBraces(`${before}${part}${after}`));
}

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** A span with `...`, `…` or `*` becomes an anchored regex over repo paths. */
function patternToRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (pattern.startsWith('.../', i)) {
      source += '(?:.*/)?';
      i += 4;
    } else if (pattern.startsWith('…/', i)) {
      source += '(?:.*/)?';
      i += 2;
    } else if (pattern[i] === '*') {
      source += '[^/]*';
      i += 1;
    } else {
      source += escapeRegex(pattern[i]);
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when one expanded log token names `file` (a repo-relative path). */
export function tokenNamesFile(token, file) {
  if (!token || /\s/.test(token)) return false;
  if (!token.includes('/')) return path.posix.basename(file) === token;
  const candidates = [token.replace(/^\.\//, '')];
  candidates.push(`${DESKTOP_PREFIX}${candidates[0]}`);
  if (/\.\.\.|…|\*/.test(token)) {
    return candidates.some((candidate) => patternToRegex(candidate).test(file));
  }
  return candidates.some((candidate) => candidate === file || file.startsWith(`${candidate}/`));
}

/** Upstream files (present at the fork base) that no added log line names. */
export function findUnlogged({ changedFiles, upstreamFiles, logDiff }) {
  const tokens = codeSpans(addedLines(logDiff)).flatMap(expandBraces);
  return changedFiles
    .filter((file) => file !== PATCH_LOG && upstreamFiles.has(file))
    .filter((file) => !tokens.some((token) => tokenNamesFile(token, file)));
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Runs the gate between merge-base(base, head) and head. Returns the unlogged files. */
export function checkUpstreamPatches({ base = 'origin/main', head = 'HEAD', git = defaultGit } = {}) {
  const mergeBase = git(['merge-base', base, head]).trim();
  const lines = (text) => text.split('\n').filter(Boolean);
  const changedFiles = lines(git(['diff', '--name-only', '--no-renames', mergeBase, head]));
  const upstreamFiles = new Set(lines(git(['ls-tree', '-r', '--name-only', FORK_BASE])));
  const logDiff = git(['diff', mergeBase, head, '--', PATCH_LOG]);
  return { mergeBase, unlogged: findUnlogged({ changedFiles, upstreamFiles, logDiff }) };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--head') options.head = argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { mergeBase, unlogged } = checkUpstreamPatches(parseArgs(process.argv.slice(2)));
  if (unlogged.length === 0) {
    console.log(`upstream-patches: every changed upstream file since ${mergeBase.slice(0, 9)} is logged.`);
    process.exit(0);
  }
  for (const file of unlogged) {
    console.error(`::error file=${file},title=Unlogged upstream patch::${file} existed at ${FORK_BASE}`);
  }
  console.error(
    `\nupstream-patches: ${unlogged.length} file(s) inherited from Emdash changed without a line in ` +
      `${PATCH_LOG}. Add a row naming each one (what changed and why) in the same PR.`
  );
  process.exit(1);
}

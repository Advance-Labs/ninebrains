/**
 * Zero-dependency changelog and release prep for Ninebrains.
 *
 * CHANGELOG.md (repo root) is newest first. Each release is `## [X.Y.Z] - YYYY-MM-DD`. An optional
 * `## [Unreleased]` section holds hand-written notes; `prepare` carries them into the release.
 *
 *   pnpm run release:prepare X.Y.Z [--date YYYY-MM-DD] [--from <ref>]
 *     Sets apps/emdash-desktop/package.json to X.Y.Z and writes the X.Y.Z section: the Unreleased
 *     notes, then the Conventional Commit titles on the first-parent history since the last `v*`
 *     tag (or --from). Review and edit the result, then open the release PR.
 *   node tooling/scripts/changelog.mjs notes X.Y.Z
 *     Prints that section's body. release.yml uses it for the release notes; it fails if missing.
 *   node tooling/scripts/changelog.mjs notes --canary
 *     Prints the Unreleased notes plus the commits since the last tag, for a canary build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORK_BASE } from './check-upstream-patches.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CHANGELOG = 'CHANGELOG.md';
export const DESKTOP_PACKAGE = 'apps/emdash-desktop/package.json';
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

export const HEADER = `# Changelog

All notable changes to Ninebrains, newest first. \`pnpm run release:prepare X.Y.Z\` writes each
release section from the Conventional Commit titles on main; edit it before the release PR merges.
Hand-written notes go under Unreleased and move into the next release.

## [Unreleased]
`;

/** Commit types that reach the changelog, in display order. Others are left out. */
export const GROUPS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['revert', 'Reverts'],
  ['docs', 'Documentation'],
];

export function parseSubject(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  return { type, scope: scope || null, breaking: Boolean(bang), description };
}

function entry({ scope, description }, sha) {
  return `- ${scope ? `**${scope}:** ` : ''}${description} (${sha.slice(0, 7)})`;
}

/** Markdown bullets grouped under `### Heading`s; breaking changes first. */
export function renderCommits(commits) {
  const breaking = [];
  const groups = new Map(GROUPS.map(([, heading]) => [heading, []]));
  for (const commit of commits) {
    const parsed = parseSubject(commit.subject);
    if (!parsed) continue;
    if (parsed.breaking || /^BREAKING[ -]CHANGE:/m.test(commit.body ?? '')) {
      breaking.push(entry(parsed, commit.sha));
      continue;
    }
    const heading = GROUPS.find(([type]) => type === parsed.type)?.[1];
    if (heading) groups.get(heading).push(entry(parsed, commit.sha));
  }
  const blocks = [];
  if (breaking.length) blocks.push(`### Breaking changes\n\n${breaking.join('\n')}`);
  for (const [heading, lines] of groups) if (lines.length) blocks.push(`### ${heading}\n\n${lines.join('\n')}`);
  return blocks.join('\n\n');
}

/** Index of each `## ` heading line, with the version it names (or 'Unreleased'). */
function headings(text) {
  const found = [];
  const re = /^## \[([^\]]+)\].*$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) found.push({ index: m.index, end: m.index + m[0].length, name: m[1] });
  return found;
}

/** The body under `## [name]`, trimmed; null when there is no such section. */
export function extractSection(changelog, name) {
  const all = headings(changelog);
  const i = all.findIndex((h) => h.name === name);
  if (i === -1) return null;
  const stop = i + 1 < all.length ? all[i + 1].index : changelog.length;
  return changelog.slice(all[i].end, stop).trim();
}

/** Empties Unreleased and puts the new release section right under it. */
export function insertRelease(changelog, { version, date, body }) {
  const text = changelog && changelog.includes('## [Unreleased]') ? changelog : HEADER + (changelog ?? '');
  const all = headings(text);
  const unreleased = all.find((h) => h.name === 'Unreleased');
  const next = all.find((h) => h.index > unreleased.index);
  const before = text.slice(0, unreleased.end);
  const after = next ? text.slice(next.index) : '';
  const section = `## [${version}] - ${date}\n\n${body.trim() || '_No user-facing changes._'}\n`;
  return `${before}\n\n${section}${after ? `\n${after}` : ''}`.replace(/\n{3,}/g, '\n\n');
}

/** Rewrites the first top-level "version" in a package.json, keeping its formatting. */
export function bumpPackageVersion(pkgText, version) {
  if (!/"version":\s*"[^"]*"/.test(pkgText)) throw new Error('No "version" field to bump');
  return pkgText.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
}

const FIELD = '\x1f';
const RECORD = '\x1e';

export function commitsSince(from, git) {
  return git(['log', '--first-parent', `--format=%H${FIELD}%s${FIELD}%b${RECORD}`, `${from}..HEAD`])
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, body] = record.split(FIELD);
      return { sha, subject, body };
    });
}

/**
 * The newest Ninebrains `v*` tag in HEAD's history, or null. Tags reachable from the fork base are
 * Emdash's (v1.2.4 and older) and never count, or the first release would start from upstream.
 */
export function lastTag(git) {
  const list = (ref) =>
    git(['tag', '--merged', ref, '--list', 'v[0-9]*', '--sort=-v:refname']).split('\n').filter(Boolean);
  const upstream = new Set(list(FORK_BASE));
  return list('HEAD').find((tag) => !upstream.has(tag)) ?? null;
}

function defaultGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readOr(file, fallback) {
  const full = path.join(REPO_ROOT, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : fallback;
}

export function prepareRelease({
  version,
  date = new Date().toISOString().slice(0, 10),
  from,
  git = defaultGit,
  read = (file) => readOr(file, null),
  write = (file, text) => writeFileSync(path.join(REPO_ROOT, file), text),
}) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`"${version}" is not a version like 0.2.0`);
  const changelog = read(CHANGELOG) ?? '';
  if (extractSection(changelog, version) !== null) throw new Error(`${CHANGELOG} already has a ${version} section`);
  const start = from ?? lastTag(git) ?? FORK_BASE;
  const commits = commitsSince(start, git);
  const notes = extractSection(changelog, 'Unreleased') ?? '';
  const body = [notes, renderCommits(commits)].filter(Boolean).join('\n\n');
  write(CHANGELOG, insertRelease(changelog, { version, date, body }));
  write(DESKTOP_PACKAGE, bumpPackageVersion(read(DESKTOP_PACKAGE), version));
  return { from: start, commits: commits.length };
}

export function canaryNotes({ git = defaultGit, read = (file) => readOr(file, null) } = {}) {
  const tag = lastTag(git);
  const notes = extractSection(read(CHANGELOG) ?? '', 'Unreleased') ?? '';
  const commits = renderCommits(commitsSince(tag ?? FORK_BASE, git));
  const since = tag ? `Changes since ${tag}.` : 'Changes since the fork base.';
  return [notes, since, commits || '_No user-facing changes._'].filter(Boolean).join('\n\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const option = (name) => {
    const i = rest.indexOf(name);
    return i === -1 ? undefined : rest[i + 1];
  };
  if (command === 'prepare') {
    const version = rest.find((arg) => !arg.startsWith('--') && arg !== option('--date') && arg !== option('--from'));
    const { from, commits } = prepareRelease({ version, date: option('--date'), from: option('--from') });
    console.log(
      `release:prepare: ${DESKTOP_PACKAGE} -> ${version}; ${CHANGELOG} section from ${commits} commit(s) since ${from}.\n` +
        'Edit CHANGELOG.md, then open the release PR (see docs/RELEASING.md).'
    );
  } else if (command === 'notes' && rest.includes('--canary')) {
    process.stdout.write(`${canaryNotes()}\n`);
  } else if (command === 'notes' && rest[0]) {
    const body = extractSection(readOr(CHANGELOG, ''), rest[0]);
    if (body === null) {
      console.error(`::error title=changelog::${CHANGELOG} has no ${rest[0]} section. Run pnpm run release:prepare ${rest[0]}.`);
      process.exit(1);
    }
    process.stdout.write(`${body}\n`);
  } else {
    console.error('Usage: changelog.mjs prepare X.Y.Z [--date D] [--from REF] | notes X.Y.Z | notes --canary');
    process.exit(2);
  }
}

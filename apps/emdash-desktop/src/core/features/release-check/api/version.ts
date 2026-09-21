/**
 * SemVer 2.0 precedence for release tags (`v0.2.0`, `0.3.0-rc.1`). Build metadata (`+…`) is
 * accepted and ignored, as the spec says. Anything else parses to `null`, and a `null` never
 * counts as newer: a malformed tag from the network can only ever mean "no notice".
 */

const MAX_VERSION_LENGTH = 64;

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type ParsedVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated prerelease identifiers; numeric ones as numbers. Empty for a release. */
  readonly prerelease: readonly (string | number)[];
};

export function parseVersion(raw: string): ParsedVersion | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VERSION_LENGTH) return null;
  const match = SEMVER_PATTERN.exec(trimmed);
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const prerelease: (string | number)[] = [];
  for (const id of match[4]?.split('.') ?? []) {
    if (/^\d+$/.test(id)) {
      const value = Number(id);
      if (!Number.isSafeInteger(value)) return null;
      prerelease.push(value);
    } else {
      prerelease.push(id);
    }
  }
  return { major, minor, patch, prerelease };
}

/** `X.Y.Z` or `X.Y.Z-pre`, without a leading `v` or build metadata; `null` when unparsable. */
export function normalizeVersion(raw: string): string | null {
  const parsed = parseVersion(raw);
  if (!parsed) return null;
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease.length > 0 ? `${core}-${parsed.prerelease.join('.')}` : core;
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Negative when `a` precedes `b`, positive when it follows, 0 when equal in precedence. */
export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  const core =
    Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch);
  if (core !== 0) return core;
  // A release outranks any prerelease of the same core version.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length);
  }
  const length = Math.min(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (result !== 0) return result;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

/** True only when both parse and `candidate` has strictly higher precedence than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const running = parseVersion(current);
  if (!next || !running) return false;
  return compareParsedVersions(next, running) > 0;
}

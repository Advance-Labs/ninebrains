/**
 * Minimal semver comparison for update feed selection. No dependency: Ninebrains only ships
 * `MAJOR.MINOR.PATCH[-pre]` versions from its own pipeline, so a small comparator is enough.
 *
 * Follows SemVer 2.0 precedence: numeric core compared numerically; a release beats a prerelease
 * of the same core; prerelease identiters compare left to right with numeric < alphanumeric and
 * fewer idents < more when all leading idents are equal.
 */
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(input: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
} | null {
  const match = VERSION_RE.exec((input ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    const av = BigInt(a);
    const bv = BigInt(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const result = compareIdentifiers(a[i], b[i]);
    if (result !== 0) return result;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. Invalid input sorts before all. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null;
}

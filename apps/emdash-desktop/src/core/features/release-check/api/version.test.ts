import { describe, expect, it } from 'vitest';
import { compareParsedVersions, isNewerVersion, normalizeVersion, parseVersion } from './version';

function compare(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`unparsable: ${a} / ${b}`);
  return compareParsedVersions(left, right);
}

describe('parseVersion', () => {
  it('parses release and prerelease tags, with or without a leading v', () => {
    expect(parseVersion('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: [] });
    expect(parseVersion('1.10.3-rc.2')).toEqual({
      major: 1,
      minor: 10,
      patch: 3,
      prerelease: ['rc', 2],
    });
  });

  it('rejects anything that is not SemVer', () => {
    for (const raw of [
      '',
      'latest',
      '1.2',
      '1.2.3.4',
      '01.2.3',
      '1.2.3-',
      '1.2.3-01',
      'vv1.2.3',
      '1.2.3 ; rm -rf /',
      '../1.2.3',
      `1.2.3-${'a'.repeat(80)}`,
      '99999999999999999999.0.0',
    ]) {
      expect(parseVersion(raw), raw).toBeNull();
    }
  });
});

describe('normalizeVersion', () => {
  it('strips the v and build metadata', () => {
    expect(normalizeVersion('v0.2.0')).toBe('0.2.0');
    expect(normalizeVersion('0.3.0-rc.1+build.5')).toBe('0.3.0-rc.1');
    expect(normalizeVersion('nope')).toBeNull();
  });
});

describe('SemVer precedence', () => {
  it('orders core versions numerically, not lexically', () => {
    expect(compare('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compare('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compare('0.2.0', 'v0.2.0')).toBe(0);
  });

  it('follows the SemVer 2.0 example ordering for prereleases', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(compare(ordered[index], ordered[index - 1]), ordered[index]).toBeGreaterThan(0);
    }
  });

  it('ignores build metadata', () => {
    expect(compare('1.0.0+a', '1.0.0+b')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly newer release', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });

  it('offers the final release to someone on its release candidate', () => {
    expect(isNewerVersion('0.3.0', '0.3.0-rc.1')).toBe(true);
    expect(isNewerVersion('0.3.0-rc.1', '0.3.0')).toBe(false);
  });

  it('never reports an update when either side is unparsable', () => {
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
    expect(isNewerVersion('9.9.9', 'unknown')).toBe(false);
  });
});

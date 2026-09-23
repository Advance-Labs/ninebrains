import { describe, expect, it } from 'vitest';
import { compareVersions, isValidVersion, parseVersion } from './version';

describe('parseVersion', () => {
  it('parses plain three-part versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses the v-prefix GitHub tags use', () => {
    expect(parseVersion('v0.2.1')?.major).toBe(0);
    expect(parseVersion('v0.2.1')?.patch).toBe(1);
  });

  it('parses a prerelease suffix and splits its identifiers', () => {
    expect(parseVersion('0.2.2-canary.5')).toEqual({
      major: 0,
      minor: 2,
      patch: 2,
      prerelease: ['canary', '5'],
    });
  });

  it('rejects junk', () => {
    for (const bad of ['', '1.2', '1..2', '1.2.3.4', 'v', '1.2.3 beta', '../9.9.9']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders numeric core parts numerically', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.2', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('9.9.9', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('gives a release precedence over prereleases of the same core', () => {
    expect(compareVersions('1.0.1', '1.0.1-canary.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1-canary.1', '1.0.1')).toBeLessThan(0);
  });

  it('compares prerelease identifiers of the same core', () => {
    expect(compareVersions('1.0.1-alpha.1', '1.0.1-alpha.2')).toBeLessThan(0);
    expect(compareVersions('1.0.1-alpha', '1.0.1-alpha.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1-alpha.beta', '1.0.1-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.1-canary.2', '1.0.1-canary.10')).toBeLessThan(0);
    expect(compareVersions('1.0.1-canary.2', '1.0.1-canary.2')).toBe(0);
  });

  it('sorts canary tags newest-first the way the feed selects a release', () => {
    const tags = ['v0.2.1-canary.9', 'v0.2.1-canary.1', 'v0.2.1-canary.17'];
    expect([...tags].sort((a, b) => compareVersions(b, a))[0]).toBe('v0.2.1-canary.17');
    expect([...tags].sort((a, b) => compareVersions(b, a))).toEqual([
      'v0.2.1-canary.17',
      'v0.2.1-canary.9',
      'v0.2.1-canary.1',
    ]);
  });

  it('sorts invalid input before valid versions', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', 'not-a-version')).toBeGreaterThan(0);
  });
});

describe('isValidVersion', () => {
  it('only accepts parseable semver', () => {
    expect(isValidVersion('0.2.2')).toBe(true);
    expect(isValidVersion('v0.2.2-canary.3')).toBe(true);
    expect(isValidVersion('zero point two')).toBe(false);
  });
});

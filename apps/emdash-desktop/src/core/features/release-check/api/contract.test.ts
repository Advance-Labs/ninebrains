import { describe, expect, it } from 'vitest';
import { latestReleaseSchema } from './contract';
import { releasePageUrl } from './release-links';

describe('latestReleaseSchema.releaseUrl', () => {
  it('accepts the GitHub release page built from a version', () => {
    for (const version of ['0.2.0', '0.3.0-rc.1']) {
      expect(
        latestReleaseSchema.safeParse({
          version,
          releaseUrl: releasePageUrl(version),
          publishedAt: null,
        }).success
      ).toBe(true);
    }
  });

  it('rejects any other link, so the renderer never opens one', () => {
    for (const releaseUrl of [
      'https://evil.example/Advance-Labs/ninebrains/releases/tag/v0.2.0',
      'http://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.0',
      'https://github.com/other/ninebrains/releases/tag/v0.2.0',
      'https://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.0/../../x',
      'https://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.0?x=1',
      'javascript:alert(1)',
    ]) {
      expect(
        latestReleaseSchema.safeParse({ version: '0.2.0', releaseUrl, publishedAt: null }).success,
        releaseUrl
      ).toBe(false);
    }
  });
});

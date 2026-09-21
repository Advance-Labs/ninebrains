import { describe, expect, it, vi } from 'vitest';
import { fetchLatestRelease, LATEST_RELEASE_API_URL, type FetchLike } from './latest-release';

function respond(status: number, body: unknown): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const release = {
  tag_name: 'v0.2.0',
  draft: false,
  prerelease: false,
  published_at: '2026-09-22T10:00:00Z',
  html_url: 'https://evil.example/phish',
};

describe('fetchLatestRelease', () => {
  it('reads tag_name from the public latest-release endpoint, unauthenticated', async () => {
    const fetchImpl = respond(200, release);

    const result = await fetchLatestRelease(fetchImpl);

    expect(result).toEqual({
      success: true,
      data: {
        version: '0.2.0',
        releaseUrl: 'https://github.com/Advance-Labs/ninebrains/releases/tag/v0.2.0',
        publishedAt: '2026-09-22T10:00:00Z',
      },
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe(LATEST_RELEASE_API_URL);
    expect(url).toBe('https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('builds the release link from the version, never from html_url', async () => {
    const result = await fetchLatestRelease(respond(200, release));
    expect(result.success && result.data.releaseUrl).not.toContain('evil');
  });

  it('maps GitHub rate limiting (403 and 429) to rate-limited', async () => {
    expect(await fetchLatestRelease(respond(403, { message: 'API rate limit exceeded' }))).toEqual({
      success: false,
      error: 'rate-limited',
    });
    expect(await fetchLatestRelease(respond(429, {}))).toEqual({
      success: false,
      error: 'rate-limited',
    });
  });

  it('maps other non-2xx answers (404 before the first release, 5xx) to http-error', async () => {
    expect(await fetchLatestRelease(respond(404, { message: 'Not Found' }))).toEqual({
      success: false,
      error: 'http-error',
    });
    expect(await fetchLatestRelease(respond(502, {}))).toEqual({
      success: false,
      error: 'http-error',
    });
  });

  it('reports offline when the request cannot be made, without throwing', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchLatestRelease(fetchImpl)).toEqual({ success: false, error: 'offline' });
  });

  it('gives up after the timeout', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    expect(await fetchLatestRelease(hanging, 5)).toEqual({ success: false, error: 'timeout' });
  });

  it('rejects bodies without a SemVer tag, drafts and prereleases', async () => {
    for (const body of [
      'not json at all',
      {},
      { tag_name: 'nightly' },
      { tag_name: 'v0.3.0', draft: true },
      { tag_name: 'v0.3.0-rc.1', prerelease: true },
      { tag_name: 42 },
    ]) {
      const fetchImpl: FetchLike = async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
      expect(await fetchLatestRelease(fetchImpl), JSON.stringify(body)).toEqual({
        success: false,
        error: 'invalid-response',
      });
    }
  });
});

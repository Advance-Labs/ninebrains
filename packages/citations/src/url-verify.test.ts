import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchText } from './types';
import { createDefaultFetchText, verifyUrlClaims } from './url-verify';

const PAGES: Record<string, string> = {
  'https://example.org/bees':
    '<html><body><article><p>A honeybee colony can hold <em>up to 60,000</em> workers ' +
    'in midsummer.</p></article></body></html>',
  'https://example.org/wasps': 'Plain text: paper wasps build nests from chewed wood fibre.',
};

function mockFetcher(): FetchText & { calls: string[] } {
  const calls: string[] = [];
  const fetchText: FetchText = async (url) => {
    calls.push(url);
    const page = PAGES[url];
    if (page === undefined) throw new Error('HTTP 404');
    return page;
  };
  return Object.assign(fetchText, { calls });
}

describe('verifyUrlClaims', () => {
  it('grounds a quote found on the fetched page and extracts text from HTML', async () => {
    const fetchText = mockFetcher();
    const result = await verifyUrlClaims(
      [
        {
          text: 'Colonies peak around 60k.',
          citations: [
            { sourceId: 'https://example.org/bees', quote: 'can hold up to 60,000 workers' },
          ],
        },
      ],
      { fetchText }
    );
    expect(result.perClaim[0].status).toBe('grounded');
    // Tags are gone from the extracted text; the markup-free length is what was checked.
    const expected = 'A honeybee colony can hold up to 60,000 workers in midsummer.';
    expect(result.fetches).toEqual([
      { url: 'https://example.org/bees', ok: true, chars: expected.length },
    ]);
  });

  it('rejects a quote the page does not contain', async () => {
    const result = await verifyUrlClaims(
      [
        {
          text: 'x',
          citations: [
            { sourceId: 'https://example.org/bees', quote: 'a colony has exactly one drone' },
          ],
        },
      ],
      { fetchText: mockFetcher() }
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.summary.pass).toBe(false);
  });

  it('maps source ids to URLs through the catalog and fetches each URL once', async () => {
    const fetchText = mockFetcher();
    const result = await verifyUrlClaims(
      [
        { text: 'a', citations: [{ sourceId: 'wasps', quote: 'paper wasps build nests' }] },
        { text: 'b', citations: [{ sourceId: 'wasps', quote: 'chewed wood fibre' }] },
      ],
      { fetchText, sources: [{ id: 'wasps', url: 'https://example.org/wasps' }] }
    );
    expect(result.perClaim.map((v) => v.status)).toEqual(['grounded', 'grounded']);
    expect(fetchText.calls).toEqual(['https://example.org/wasps']);
  });

  it('treats an unfetchable URL as invented and says why', async () => {
    const result = await verifyUrlClaims(
      [{ text: 'x', citations: [{ sourceId: 'https://example.org/gone', quote: 'anything' }] }],
      { fetchText: mockFetcher() }
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.perClaim[0].reasons[0]).toMatch(
      /fetch of https:\/\/example.org\/gone failed: HTTP 404/
    );
    expect(result.fetches[0]).toMatchObject({ ok: false, error: 'HTTP 404' });
  });

  it('treats a citation with no resolvable URL as invented', async () => {
    const result = await verifyUrlClaims(
      [{ text: 'x', citations: [{ sourceId: 'my-notes', quote: 'q' }] }],
      { fetchText: mockFetcher() }
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.perClaim[0].reasons[0]).toMatch(/no URL to verify/);
  });

  it('requires a quote: a fetched page with nothing quoted is imprecise', async () => {
    const result = await verifyUrlClaims(
      [{ text: 'x', citations: [{ sourceId: 'https://example.org/bees' }] }],
      { fetchText: mockFetcher() }
    );
    expect(result.perClaim[0].status).toBe('imprecise');
  });

  it('keeps uncited claims uncited', async () => {
    const result = await verifyUrlClaims([{ text: 'x', citations: [] }], {
      fetchText: mockFetcher(),
    });
    expect(result.perClaim[0].status).toBe('uncited');
  });
});

describe('createDefaultFetchText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses non-http(s) URLs', async () => {
    await expect(createDefaultFetchText()('file:///etc/passwd', {})).rejects.toThrow(/non-http/);
  });

  it('caps the body at maxBytes', async () => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(10_000)));
    const body = await createDefaultFetchText({ maxBytes: 100 })('https://example.org/', {});
    expect(body.length).toBe(100);
  });

  it('throws on a non-2xx status', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }));
    await expect(createDefaultFetchText()('https://example.org/', {})).rejects.toThrow('HTTP 503');
  });
});

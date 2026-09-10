import { describe, expect, it, vi } from 'vitest';
import { makeContext, makeJob } from '../test-utils';
import { factCheckGate } from './fact-check-gate';

const PAGE =
  '<html><body><p>The lighthouse was automated in 1987 and its lamp is visible for 18 nautical ' +
  'miles.</p></body></html>';

function setup(
  claims: unknown,
  pages: Record<string, string> = { 'https://example.org/lighthouse': PAGE }
) {
  const fetchText = vi.fn(async (url: string) => {
    if (!(url in pages)) throw new Error('HTTP 404');
    return pages[url];
  });
  const readWorktreeFile = vi.fn(async (file: string) => {
    if (claims === undefined) throw new Error(`ENOENT: ${file}`);
    return typeof claims === 'string' ? claims : JSON.stringify(claims);
  });
  const ctx = makeContext({
    job: { kind: 'research' },
    capabilities: { fetchText, readWorktreeFile },
  });
  return { ctx, fetchText, readWorktreeFile };
}

const grounded = {
  text: 'It was automated in 1987.',
  citations: [{ sourceId: 'https://example.org/lighthouse', quote: 'automated in 1987' }],
};

describe('factCheckGate', () => {
  it('passes when every claim is grounded on the fetched page', async () => {
    const { ctx, readWorktreeFile } = setup({ claims: [grounded] });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(true);
    expect(readWorktreeFile).toHaveBeenCalledWith('claims.json', expect.anything());
    expect(result.metrics).toMatchObject({ claims: 1, grounded: 1, passRate: 1 });
    expect(result.evidence[0].kind).toBe('json');
  });

  it('rejects an invented quote and names the claim', async () => {
    const { ctx } = setup({
      claims: [
        grounded,
        {
          text: 'The keeper lived there until 2010.',
          citations: [
            { sourceId: 'https://example.org/lighthouse', quote: 'the last keeper left in 2010' },
          ],
        },
      ],
    });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('1 of 2 claims are unsupported');
    expect(result.feedback).toContain('"The keeper lived there until 2010." → invented');
    expect(result.metrics?.invented).toBe(1);
  });

  it('rejects an uncited claim', async () => {
    const { ctx } = setup({
      claims: [{ text: 'It is the tallest in the region.', citations: [] }],
    });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('→ uncited');
  });

  it('passes imprecise claims with a warning', async () => {
    const { ctx } = setup({
      claims: [{ text: 'x', citations: [{ sourceId: 'https://example.org/lighthouse' }] }],
    });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(true);
    expect(result.feedback).toMatch(/imprecise and worth tightening/);
  });

  it('ignores source text pasted into claims.json in url mode', async () => {
    // The pasted "text" supports the quote; the live page does not.
    const forged = 'The lighthouse was demolished in 2004 to make way for a hotel.';
    const { ctx } = setup({
      claims: [{ text: 'x', citations: [{ sourceId: 'lh', quote: 'demolished in 2004' }] }],
      sources: [{ id: 'lh', url: 'https://example.org/lighthouse', text: forged }],
    });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.metrics?.invented).toBe(1);
  });

  it('rejects a quote with a changed number even when the wording matches', async () => {
    const { ctx } = setup({
      claims: [
        {
          text: 'Visible for 40 miles.',
          citations: [
            { sourceId: 'https://example.org/lighthouse', quote: 'visible for 40 nautical miles' },
          ],
        },
      ],
    });
    const result = await factCheckGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.metrics?.invented).toBe(1);
  });

  it('fails clearly on a missing, malformed or empty claims file', async () => {
    expect((await factCheckGate().run(setup(undefined).ctx)).feedback).toMatch(
      /Could not read claims.json: ENOENT/
    );
    expect((await factCheckGate().run(setup('{not json').ctx)).feedback).toMatch(
      /claims.json is invalid/
    );
    expect((await factCheckGate().run(setup({ claims: [{ text: 1 }] }).ctx)).feedback).toContain(
      'claims[0].text'
    );
    expect((await factCheckGate().run(setup({ claims: [] }).ctx)).feedback).toMatch(
      /contains no claims/
    );
  });

  it('validates against a trusted source set in sources mode', async () => {
    const { ctx, fetchText } = setup({
      claims: [{ text: 'x', citations: [{ sourceId: 'log-1', quote: 'lamp is visible' }] }],
    });
    const gate = factCheckGate({
      mode: 'sources',
      loadSources: async () => [
        { id: 'log-1', text: 'Its lamp is visible for 18 nautical miles.' },
      ],
    });
    expect((await gate.run(ctx)).pass).toBe(true);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('validates its configuration and applies to research and SEO jobs', () => {
    expect(() => factCheckGate({ claimsPath: '../claims.json' })).toThrow();
    expect(() => factCheckGate({ claimsPath: '/etc/claims.json' })).toThrow();
    expect(() => factCheckGate({ mode: 'sources' })).toThrow();
    const gate = factCheckGate();
    expect(gate.appliesTo(makeJob({ kind: 'seo' }))).toBe(true);
    expect(gate.appliesTo(makeJob({ kind: 'ui' }))).toBe(false);
  });
});

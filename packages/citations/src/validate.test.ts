/**
 * Claim validator tests.
 *
 * A validator with no test proving it rejects an invented citation proves
 * nothing, so that case is here. The rest guard the ways a validator can pass
 * that test and still be wrong: by rejecting honest claims (imprecise is not
 * invented), or by accepting a real source with a made-up quote.
 */

import { describe, expect, it } from 'vitest';
import type { Source } from './types';
import { sharesLineage, validateClaims } from './validate';

const KETTLE: Source = {
  id: 'kettle-manual',
  title: 'Stovetop Kettle Care Guide',
  text:
    'Descale the kettle once a month with a solution of one part white vinegar to two parts ' +
    'water. Never heat the kettle while it is empty, because the base can warp.',
};

const ORCHARD: Source[] = [
  {
    id: 'orchard/pruning/winter',
    hierarchy: ['orchard', 'pruning', 'winter'],
    text: 'Prune apple trees in late winter, before the buds break, removing crossing branches.',
  },
  {
    id: 'orchard/pruning/summer',
    hierarchy: ['orchard', 'pruning', 'summer'],
    text: 'Summer pruning slows vigorous growth and lets light reach the fruit.',
  },
];

describe('validateClaims', () => {
  it('marks a claim grounded when its source was retrieved and the quote appears', () => {
    const result = validateClaims(
      [
        {
          text: 'Descale monthly.',
          citations: [{ sourceId: 'kettle-manual', quote: 'Descale the kettle once a month' }],
        },
      ],
      [KETTLE]
    );
    expect(result.perClaim[0].status).toBe('grounded');
    expect(result.perClaim[0].citations[0].quoteScore).toBe(1);
    expect(result.summary).toMatchObject({ grounded: 1, pass: true, passRate: 1 });
  });

  it('rejects an invented source id', () => {
    const result = validateClaims(
      [{ text: 'Kettles last ten years.', citations: [{ sourceId: 'kettle-lifespan-study' }] }],
      [KETTLE]
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.perClaim[0].reasons.join(' ')).toMatch(/not among the retrieved/);
    expect(result.summary.pass).toBe(false);
  });

  it('rejects a real source with a quote it does not contain', () => {
    const result = validateClaims(
      [
        {
          text: 'Use lemon juice.',
          citations: [
            { sourceId: 'kettle-manual', quote: 'Lemon juice removes limescale in minutes' },
          ],
        },
      ],
      [KETTLE]
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.perClaim[0].citations[0].matchedSourceId).toBe('kettle-manual');
  });

  it('marks a claim with no citations uncited, and uncited fails the summary', () => {
    const result = validateClaims([{ text: 'Everyone agrees.', citations: [] }], [KETTLE]);
    expect(result.perClaim[0].status).toBe('uncited');
    expect(result.summary).toMatchObject({ uncited: 1, pass: false, passRate: 0 });
  });

  it('distinguishes an imprecise hierarchy ancestor from an invention', () => {
    // 'orchard/pruning' was not retrieved, but its children were: the model
    // named a real parent of its own source material.
    const result = validateClaims(
      [
        { text: 'Prune in winter.', citations: [{ sourceId: 'orchard/pruning' }] },
        { text: 'Graft in spring.', citations: [{ sourceId: 'orchard/grafting' }] },
      ],
      ORCHARD
    );
    expect(result.perClaim[0].status).toBe('imprecise');
    expect(result.perClaim[1].status).toBe('invented');
    expect(result.summary).toMatchObject({ imprecise: 1, invented: 1, pass: false });
  });

  it('treats a cited descendant of a retrieved node as imprecise', () => {
    const result = validateClaims(
      [{ text: 'x', citations: [{ sourceId: 'orchard/pruning/winter/apples' }] }],
      ORCHARD
    );
    expect(result.perClaim[0].status).toBe('imprecise');
  });

  it('honours a custom citation path resolver and separator', () => {
    const sources: Source[] = [{ id: 'A.2.1', hierarchy: ['A', '2', '1'], text: 'alpha' }];
    const dotted = validateClaims([{ text: 'x', citations: [{ sourceId: 'A.2' }] }], sources, {
      hierarchySeparator: '.',
    });
    expect(dotted.perClaim[0].status).toBe('imprecise');
    const optedOut = validateClaims([{ text: 'x', citations: [{ sourceId: 'A.2' }] }], sources, {
      hierarchySeparator: '.',
      citationPath: () => undefined,
    });
    expect(optedOut.perClaim[0].status).toBe('invented');
  });

  it('accepts a lightly paraphrased quote through the fuzzy fallback', () => {
    const result = validateClaims(
      [
        {
          text: 'Do not dry-heat it.',
          citations: [
            {
              sourceId: 'kettle-manual',
              // One word changed ("when" for "while") out of fourteen.
              quote: 'Never heat the kettle when it is empty, because the base can warp.',
            },
          ],
        },
      ],
      [KETTLE]
    );
    const verdict = result.perClaim[0].citations[0];
    expect(verdict.status).toBe('grounded');
    expect(verdict.quoteScore).toBeGreaterThanOrEqual(0.85);
    expect(verdict.quoteScore).toBeLessThan(1);
  });

  it('marks a loosely resembling quote imprecise, below the fuzzy threshold', () => {
    const result = validateClaims(
      [
        {
          text: 'x',
          citations: [
            { sourceId: 'kettle-manual', quote: 'never boil the kettle while it is dry and cold' },
          ],
        },
      ],
      [KETTLE],
      { looseThreshold: 0.4 }
    );
    expect(result.perClaim[0].status).toBe('imprecise');
  });

  it('marks a quote found in a different retrieved source as imprecise', () => {
    const result = validateClaims(
      [
        {
          text: 'Light reaches the fruit.',
          citations: [{ sourceId: 'orchard/pruning/winter', quote: 'lets light reach the fruit' }],
        },
      ],
      ORCHARD
    );
    expect(result.perClaim[0].status).toBe('imprecise');
    expect(result.perClaim[0].citations[0].matchedSourceId).toBe('orchard/pruning/summer');
  });

  it('lets the worst citation decide the claim', () => {
    const result = validateClaims(
      [
        {
          text: 'x',
          citations: [{ sourceId: 'kettle-manual' }, { sourceId: 'made-up' }],
        },
      ],
      [KETTLE]
    );
    expect(result.perClaim[0].status).toBe('invented');
    expect(result.perClaim[0].citations.map((c) => c.status)).toEqual(['grounded', 'invented']);
  });

  it('with requireQuote, a quoteless citation is at best imprecise', () => {
    const result = validateClaims(
      [{ text: 'x', citations: [{ sourceId: 'kettle-manual' }] }],
      [KETTLE],
      { requireQuote: true }
    );
    expect(result.perClaim[0].status).toBe('imprecise');
  });

  it('an empty retrieved set makes every citation invented', () => {
    const result = validateClaims(
      [{ text: 'x', citations: [{ sourceId: 'kettle-manual', quote: 'Descale' }] }],
      []
    );
    expect(result.perClaim[0].status).toBe('invented');
  });

  it('reports a vacuous pass for no claims', () => {
    expect(validateClaims([], [KETTLE]).summary).toMatchObject({ total: 0, pass: true });
  });
});

describe('sharesLineage', () => {
  it('is true for prefixes in either direction and false for siblings', () => {
    expect(sharesLineage(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(sharesLineage(['a', 'b', 'c'], ['a', 'b'])).toBe(true);
    expect(sharesLineage(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sharesLineage([], ['a'])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { matchQuote, normalizeText } from './quote';

describe('normalizeText', () => {
  it('folds case, punctuation, curly quotes and whitespace', () => {
    expect(normalizeText('  Don’t   PANIC —\n“towel”!  ')).toBe('don t panic towel');
  });

  it('applies NFKC so full-width characters match their ASCII forms', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('abc123');
  });
});

describe('matchQuote', () => {
  const source = 'The ferry leaves the north pier at 7:15 a.m. on weekdays, weather permitting.';

  it('matches verbatim regardless of punctuation and line breaks', () => {
    expect(matchQuote('the ferry leaves the North Pier\nat 7 15 a m', source)).toEqual({
      score: 1,
      exact: true,
    });
  });

  it('scores a one-word substitution high but below 1', () => {
    const { score, exact } = matchQuote('The ferry departs the north pier at 7:15 a.m.', source);
    expect(exact).toBe(false);
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThan(1);
  });

  it('never fuzzily matches a quote whose number was changed', () => {
    // Every word but the time matches; a fact-check must still reject it.
    expect(matchQuote('The ferry leaves the north pier at 8:15 a.m.', source).score).toBe(0);
    expect(matchQuote('leaves at 7 15', 'The ferry leaves at 7:15.').exact).toBe(true);
  });

  it('scores an unrelated sentence near zero', () => {
    expect(matchQuote('Bananas are rich in potassium and fibre', source).score).toBeLessThan(0.3);
  });

  it('returns 0 for an empty quote or empty source', () => {
    expect(matchQuote('   ', source).score).toBe(0);
    expect(matchQuote('ferry', '').score).toBe(0);
  });
});

/**
 * Quote verification: does a quoted span actually appear in a source?
 *
 * Generalised from Advance Labs' BuildCode citation validator (2026).
 *
 * Two passes. The exact pass normalises both sides (case, Unicode width,
 * punctuation, whitespace) and does a substring check, so "don't" vs "don’t" or
 * a reflowed line break never fails an honest quote. The fuzzy pass handles the
 * remaining honest drift (a dropped word, a tense change) by comparing the quote
 * against same-length token windows of the source with a token-level edit
 * distance. It only runs on windows that already share most of the quote's
 * vocabulary, so it stays linear in the source length in practice.
 */

const PUNCT_OR_SYMBOL = /[\p{P}\p{S}]+/gu;
const WHITESPACE = /\s+/g;

/** Lower-case, NFKC, punctuation and symbols to spaces, whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(PUNCT_OR_SYMBOL, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** Token-level Levenshtein distance. */
function tokenDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

export interface QuoteMatch {
  /** 1 for a normalised verbatim match, otherwise the best fuzzy similarity 0..1. */
  score: number;
  exact: boolean;
}

/**
 * Minimum shared-vocabulary fraction for a window to be worth an edit-distance
 * pass. Below this no window can reach any threshold we care about.
 */
const CANDIDATE_OVERLAP = 0.5;

/** Score how well `quote` is supported by `sourceText`. */
export function matchQuote(quote: string, sourceText: string): QuoteMatch {
  const q = normalizeText(quote);
  if (q.length === 0) return { score: 0, exact: false };
  const s = normalizeText(sourceText);
  if (s.includes(q)) return { score: 1, exact: true };

  const quoteTokens = q.split(' ');
  const sourceTokens = s.length === 0 ? [] : s.split(' ');
  const n = quoteTokens.length;
  if (sourceTokens.length === 0) return { score: 0, exact: false };

  const need = new Map<string, number>();
  for (const token of quoteTokens) need.set(token, (need.get(token) ?? 0) + 1);
  // Numbers are what a fact-check exists to catch: "40 miles" must never
  // fuzzily match "18 miles", however similar the surrounding words.
  const numbers = [...new Set(quoteTokens.filter((token) => /\d/.test(token)))];

  let best = 0;
  for (const size of new Set([Math.max(1, n - 1), n, n + 1])) {
    if (size > sourceTokens.length) continue;
    const have = new Map<string, number>();
    let overlap = 0;
    const add = (token: string, delta: 1 | -1) => {
      const wanted = need.get(token);
      if (wanted === undefined) return;
      const before = have.get(token) ?? 0;
      const after = before + delta;
      have.set(token, after);
      overlap += Math.min(after, wanted) - Math.min(before, wanted);
    };

    for (let i = 0; i < size; i += 1) add(sourceTokens[i], 1);
    for (let start = 0; start + size <= sourceTokens.length; start += 1) {
      if (start > 0) {
        add(sourceTokens[start - 1], -1);
        add(sourceTokens[start + size - 1], 1);
      }
      if (overlap / n < CANDIDATE_OVERLAP) continue;
      const window = sourceTokens.slice(start, start + size);
      if (!numbers.every((number) => window.includes(number))) continue;
      const score = 1 - tokenDistance(quoteTokens, window) / Math.max(n, size);
      if (score > best) best = score;
      if (best === 1) return { score: 1, exact: false };
    }
  }

  return { score: best, exact: false };
}

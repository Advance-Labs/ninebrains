/**
 * The claim validator.
 *
 * Generalised from Advance Labs' BuildCode citation validator (2026).
 *
 * ## What this proves, and what it cannot
 *
 * It answers one question: **was everything a claim cites actually in the set
 * of sources the model was given, and does the quoted text really appear
 * there?** That turns "verifiable" from a hope into a checkable property.
 *
 * It does NOT prove the retrieved source was the right one. If retrieval hands
 * the model the wrong document, every citation validates green and the claim
 * can still be wrong. Retrieval quality is measured separately — see
 * `metrics.ts`, which reports precision@k next to validator pass rate and never
 * conflates the two numbers.
 *
 * ## Four outcomes, not two
 *
 *   - grounded:  the cited source was retrieved and any quote appears in it.
 *   - imprecise: something real was cited, but not exactly. The cited node is
 *                an ancestor or descendant of a retrieved one, the quote
 *                appears in a different retrieved source, or the quote only
 *                loosely resembles the source. Surfacing this as fabrication
 *                would fail honest answers.
 *   - invented:  nothing retrieved backs the citation.
 *   - uncited:   the claim cites nothing at all.
 *
 * A claim takes the worst verdict among its citations: one invented citation
 * makes the claim invented, because the claim leans on it.
 *
 * `retrieved` must be the exact set placed in the model's context. Passing a
 * wider set (the whole corpus) makes every real identifier validate and reduces
 * this to a spell-check.
 */

import { matchQuote } from './quote';
import type {
  Citation,
  CitationStatus,
  CitationVerdict,
  Claim,
  ClaimStatus,
  ClaimVerdict,
  Source,
  ValidateOptions,
  ValidationResult,
  ValidationSummary,
} from './types';

export const DEFAULT_FUZZY_THRESHOLD = 0.85;
export const DEFAULT_LOOSE_THRESHOLD = 0.6;

const SEVERITY: Record<ClaimStatus, number> = {
  grounded: 0,
  imprecise: 1,
  invented: 2,
  uncited: 3,
};

/** True when `a` is a prefix of `b` or vice versa — same branch of the tree. */
export function sharesLineage(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((segment, i) => segment === longer[i]);
}

interface Resolved {
  fuzzy: number;
  loose: number;
  requireQuote: boolean;
  citationPath: (citation: Citation) => string[] | undefined;
}

function resolveOptions(options: ValidateOptions): Resolved {
  const fuzzy = options.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const loose = Math.min(options.looseThreshold ?? DEFAULT_LOOSE_THRESHOLD, fuzzy);
  const separator = options.hierarchySeparator ?? '/';
  return {
    fuzzy,
    loose,
    requireQuote: options.requireQuote ?? false,
    citationPath:
      options.citationPath ??
      ((citation) => citation.sourceId.split(separator).filter((part) => part.length > 0)),
  };
}

function fmt(score: number): string {
  return score.toFixed(2);
}

function evaluateCitation(
  citation: Citation,
  byId: Map<string, Source>,
  retrieved: Source[],
  opts: Resolved
): CitationVerdict {
  const exact = byId.get(citation.sourceId);
  const quote = citation.quote?.trim();

  if (exact) {
    if (!quote) {
      if (opts.requireQuote) {
        return {
          citation,
          status: 'imprecise',
          matchedSourceId: exact.id,
          reasons: [`"${exact.id}" was retrieved but the citation quotes nothing to check`],
        };
      }
      return {
        citation,
        status: 'grounded',
        matchedSourceId: exact.id,
        reasons: [`"${exact.id}" was retrieved`],
      };
    }

    const match = matchQuote(quote, exact.text);
    if (match.exact) {
      return {
        citation,
        status: 'grounded',
        matchedSourceId: exact.id,
        quoteScore: 1,
        reasons: [`quote appears verbatim in "${exact.id}"`],
      };
    }
    if (match.score >= opts.fuzzy) {
      return {
        citation,
        status: 'grounded',
        matchedSourceId: exact.id,
        quoteScore: match.score,
        reasons: [`quote matches "${exact.id}" with similarity ${fmt(match.score)}`],
      };
    }
    const elsewhere = findQuoteElsewhere(quote, retrieved, exact.id, opts.fuzzy);
    if (elsewhere) {
      return {
        citation,
        status: 'imprecise',
        matchedSourceId: elsewhere.id,
        quoteScore: elsewhere.score,
        reasons: [`quote is not in "${exact.id}" but appears in retrieved "${elsewhere.id}"`],
      };
    }
    if (match.score >= opts.loose) {
      return {
        citation,
        status: 'imprecise',
        matchedSourceId: exact.id,
        quoteScore: match.score,
        reasons: [
          `quote only loosely resembles "${exact.id}" (similarity ${fmt(match.score)}, ` +
            `needs ${fmt(opts.fuzzy)})`,
        ],
      };
    }
    return {
      citation,
      status: 'invented',
      matchedSourceId: exact.id,
      quoteScore: match.score,
      reasons: [`quote does not appear in "${exact.id}" (best similarity ${fmt(match.score)})`],
    };
  }

  // Not retrieved by id. A real ancestor/descendant of a retrieved node, or a
  // quote that lands in some retrieved source, is imprecise rather than invented.
  const path = opts.citationPath(citation);
  if (path && path.length > 0) {
    const related = retrieved.filter(
      (source) => source.hierarchy && sharesLineage(path, source.hierarchy)
    );
    if (related.length > 0) {
      return {
        citation,
        status: 'imprecise',
        matchedSourceId: related[0].id,
        reasons: [
          `"${citation.sourceId}" was not retrieved, but shares a hierarchy branch with ` +
            related.map((source) => `"${source.id}"`).join(', '),
        ],
      };
    }
  }

  if (quote) {
    const elsewhere = findQuoteElsewhere(quote, retrieved, undefined, opts.fuzzy);
    if (elsewhere) {
      return {
        citation,
        status: 'imprecise',
        matchedSourceId: elsewhere.id,
        quoteScore: elsewhere.score,
        reasons: [
          `"${citation.sourceId}" was not retrieved, but the quote appears in "${elsewhere.id}"`,
        ],
      };
    }
  }

  return {
    citation,
    status: 'invented',
    reasons: [`"${citation.sourceId}" is not among the retrieved sources`],
  };
}

function findQuoteElsewhere(
  quote: string,
  retrieved: Source[],
  skipId: string | undefined,
  threshold: number
): { id: string; score: number } | undefined {
  let best: { id: string; score: number } | undefined;
  for (const source of retrieved) {
    if (source.id === skipId) continue;
    const { score } = matchQuote(quote, source.text);
    if (score >= threshold && (!best || score > best.score)) best = { id: source.id, score };
  }
  return best;
}

function worst(statuses: CitationStatus[]): ClaimStatus {
  return statuses.reduce<ClaimStatus>(
    (acc, status) => (SEVERITY[status] > SEVERITY[acc] ? status : acc),
    'grounded'
  );
}

export function summarize(perClaim: ClaimVerdict[]): ValidationSummary {
  const count = (status: ClaimStatus) => perClaim.filter((v) => v.status === status).length;
  const summary = {
    total: perClaim.length,
    grounded: count('grounded'),
    imprecise: count('imprecise'),
    invented: count('invented'),
    uncited: count('uncited'),
  };
  return {
    ...summary,
    passRate: summary.total === 0 ? 1 : summary.grounded / summary.total,
    pass: summary.invented === 0 && summary.uncited === 0,
  };
}

/** Validate every claim against the sources that were actually retrieved. */
export function validateClaims(
  claims: Claim[],
  retrievedSources: Source[],
  options: ValidateOptions = {}
): ValidationResult {
  const opts = resolveOptions(options);
  const byId = new Map(retrievedSources.map((source) => [source.id, source]));

  const perClaim = claims.map((claim) =>
    buildClaimVerdict(
      claim,
      claim.citations.map((citation) => evaluateCitation(citation, byId, retrievedSources, opts))
    )
  );

  return { perClaim, summary: summarize(perClaim) };
}

/** Fold per-citation verdicts into one claim verdict: the worst citation wins. */
export function buildClaimVerdict(claim: Claim, citations: CitationVerdict[]): ClaimVerdict {
  if (claim.citations.length === 0) {
    return { claim, status: 'uncited', citations: [], reasons: ['claim cites no source'] };
  }
  const status = worst(citations.map((c) => c.status));
  const reasons = citations
    .filter((c) => c.status === status)
    .flatMap((c) => c.reasons.map((reason) => `${c.citation.sourceId}: ${reason}`));
  return { claim, status, citations, reasons };
}

/**
 * Shared types for claim and citation validation.
 *
 * Generalised from Advance Labs' BuildCode citation validator (2026).
 */

/** A piece of material that was actually placed in the model's context. */
export interface Source {
  id: string;
  url?: string;
  title?: string;
  /**
   * Ordered path from the root of a document tree down to this source, e.g.
   * `['handbook', 'chapter-2', '2.1']`. Present only for sources that live in a
   * hierarchy; enables the imprecise-ancestor check.
   */
  hierarchy?: string[];
  text: string;
}

export interface Citation {
  sourceId: string;
  /** Exact span the claim relies on. When present it is verified against the source text. */
  quote?: string;
  /** Free-form position hint such as "p. 4" or "Table 3". Reported, never trusted. */
  locator?: string;
}

export interface Claim {
  text: string;
  citations: Citation[];
}

export type ClaimStatus = 'grounded' | 'imprecise' | 'invented' | 'uncited';

export type CitationStatus = Exclude<ClaimStatus, 'uncited'>;

export interface CitationVerdict {
  citation: Citation;
  status: CitationStatus;
  /** The retrieved source this citation resolved to, when one did. */
  matchedSourceId?: string;
  /** Best quote similarity found, 0..1. Absent when the citation has no quote. */
  quoteScore?: number;
  reasons: string[];
}

export interface ClaimVerdict {
  claim: Claim;
  status: ClaimStatus;
  citations: CitationVerdict[];
  reasons: string[];
}

export interface ValidationSummary {
  total: number;
  grounded: number;
  imprecise: number;
  invented: number;
  uncited: number;
  /** grounded / total. 1 when there are no claims. */
  passRate: number;
  /** True when no claim is invented or uncited. Imprecise claims do not fail. */
  pass: boolean;
}

export interface ValidationResult {
  perClaim: ClaimVerdict[];
  summary: ValidationSummary;
}

export interface QuoteMatchOptions {
  /** Similarity at or above which a non-verbatim quote still counts as grounded. Default 0.85. */
  fuzzyThreshold?: number;
  /** Similarity at or above which a quote counts as imprecise rather than invented. Default 0.6. */
  looseThreshold?: number;
}

export interface ValidateOptions extends QuoteMatchOptions {
  /**
   * Resolve the hierarchy path a citation points at. Default: split `sourceId`
   * on `hierarchySeparator`. Return undefined to opt a citation out of the
   * hierarchy check.
   */
  citationPath?: (citation: Citation) => string[] | undefined;
  /** Separator used by the default `citationPath`. Default '/'. */
  hierarchySeparator?: string;
  /**
   * When true, a citation with no quote can be at best imprecise: the source
   * exists but nothing checkable was asserted about it. Default false.
   */
  requireQuote?: boolean;
}

/** Fetches a URL and returns its body as text. Injected so the app can supply an SSRF-safe fetcher. */
export type FetchText = (url: string, init: { signal?: AbortSignal }) => Promise<string>;

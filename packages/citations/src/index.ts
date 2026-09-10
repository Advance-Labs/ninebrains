// Generalised from Advance Labs' BuildCode citation validator (2026).
export type {
  Citation,
  CitationStatus,
  CitationVerdict,
  Claim,
  ClaimStatus,
  ClaimVerdict,
  FetchText,
  QuoteMatchOptions,
  Source,
  ValidateOptions,
  ValidationResult,
  ValidationSummary,
} from './types';
export {
  DEFAULT_FUZZY_THRESHOLD,
  DEFAULT_LOOSE_THRESHOLD,
  buildClaimVerdict,
  sharesLineage,
  summarize,
  validateClaims,
} from './validate';
export { matchQuote, normalizeText, type QuoteMatch } from './quote';
export { decodeEntities, extractReadableText, looksLikeHtml } from './html';
export {
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  createDefaultFetchText,
  defaultFetchText,
  verifyUrlClaims,
  type DefaultFetchOptions,
  type UrlFetchRecord,
  type UrlVerificationResult,
  type VerifyUrlOptions,
} from './url-verify';
export {
  hitRateAtK,
  precisionAtK,
  qualityReport,
  validatorPassRate,
  type QualityReport,
  type RetrievalRun,
} from './metrics';
export { ClaimsFormatError, parseClaimsDocument, type ClaimsDocument } from './parse';

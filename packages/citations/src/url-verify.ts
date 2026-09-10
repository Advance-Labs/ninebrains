/**
 * Verify claims against the live pages they cite.
 *
 * Generalised from Advance Labs' BuildCode citation validator (2026).
 *
 * The retrieved set here is whatever the cited URLs return right now, fetched
 * by us rather than reported by the agent. An agent that pastes "source text"
 * into its own output can forge it; a page we fetch ourselves it cannot.
 *
 * `fetchText` is injected. The default below uses native fetch with a timeout
 * and a size cap but does NOT defend against SSRF (private addresses, DNS
 * rebinding). The app must pass its net-guard fetcher for untrusted URLs.
 */

import { extractReadableText, looksLikeHtml } from './html';
import type {
  Citation,
  CitationVerdict,
  Claim,
  FetchText,
  Source,
  ValidateOptions,
  ValidationResult,
} from './types';
import { buildClaimVerdict, summarize, validateClaims } from './validate';

export interface DefaultFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const DEFAULT_FETCH_MAX_BYTES = 2_000_000;

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - size;
    const chunk = value.byteLength > room ? value.subarray(0, room) : value;
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

/** A fetcher on native `fetch`: http(s) only, with a timeout and a body size cap. Not SSRF-safe. */
export function createDefaultFetchText(options: DefaultFetchOptions = {}): FetchText {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
  return async (url, { signal } = {}) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`refusing to fetch non-http(s) URL: ${parsed.protocol}`);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(parsed, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'follow',
      headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return readCapped(response, maxBytes);
  };
}

export const defaultFetchText: FetchText = createDefaultFetchText();

export interface VerifyUrlOptions extends ValidateOptions {
  fetchText?: FetchText;
  /** Maps citation sourceIds to URLs. A sourceId that is itself an http(s) URL needs no entry. */
  sources?: Array<Pick<Source, 'id' | 'url' | 'title'>>;
  /** Parallel fetches. Default 4. */
  concurrency?: number;
  signal?: AbortSignal;
}

export interface UrlFetchRecord {
  url: string;
  ok: boolean;
  error?: string;
  chars?: number;
}

export interface UrlVerificationResult extends ValidationResult {
  fetches: UrlFetchRecord[];
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Fetch every cited URL once, extract its readable text, and check each quote
 * against the page it cites. Quotes are required: a citation with no quote can
 * be at best imprecise, since nothing checkable was asserted. A URL that cannot
 * be fetched makes its citation invented — unverifiable is not grounded.
 */
export async function verifyUrlClaims(
  claims: Claim[],
  options: VerifyUrlOptions = {}
): Promise<UrlVerificationResult> {
  const fetchText = options.fetchText ?? defaultFetchText;
  const catalog = new Map((options.sources ?? []).map((source) => [source.id, source]));

  const urlFor = (citation: Citation): string | undefined => {
    const mapped = catalog.get(citation.sourceId)?.url;
    if (mapped && isHttpUrl(mapped)) return mapped;
    return isHttpUrl(citation.sourceId) ? citation.sourceId : undefined;
  };

  const urls = [
    ...new Set(
      claims.flatMap((claim) => claim.citations.map(urlFor)).filter((u): u is string => !!u)
    ),
  ];
  const pages = new Map<string, { text?: string; error?: string }>();

  await pool(urls, options.concurrency ?? 4, async (url) => {
    if (options.signal?.aborted) {
      pages.set(url, { error: 'aborted' });
      return;
    }
    try {
      const body = await fetchText(url, { signal: options.signal });
      pages.set(url, { text: looksLikeHtml(body) ? extractReadableText(body) : body });
    } catch (error) {
      pages.set(url, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const fetchedSources: Source[] = [];
  const seenIds = new Set<string>();
  for (const claim of claims) {
    for (const citation of claim.citations) {
      const url = urlFor(citation);
      const text = url ? pages.get(url)?.text : undefined;
      if (url === undefined || text === undefined || seenIds.has(citation.sourceId)) continue;
      seenIds.add(citation.sourceId);
      const title = catalog.get(citation.sourceId)?.title;
      fetchedSources.push({ id: citation.sourceId, url, title, text });
    }
  }

  const base = validateClaims(claims, fetchedSources, {
    ...options,
    requireQuote: options.requireQuote ?? true,
    // URLs have no document tree to be imprecise within.
    citationPath: () => undefined,
  });

  const annotate = (verdict: CitationVerdict): CitationVerdict => {
    const url = urlFor(verdict.citation);
    if (url === undefined) {
      return { ...verdict, reasons: ['no URL to verify against', ...verdict.reasons] };
    }
    const error = pages.get(url)?.error;
    if (error !== undefined) {
      return { ...verdict, reasons: [`fetch of ${url} failed: ${error}`, ...verdict.reasons] };
    }
    return verdict;
  };

  const perClaim = base.perClaim.map((verdict) =>
    buildClaimVerdict(verdict.claim, verdict.citations.map(annotate))
  );

  return {
    perClaim,
    summary: summarize(perClaim),
    fetches: urls.map((url) => {
      const page = pages.get(url);
      return page?.text !== undefined
        ? { url, ok: true, chars: page.text.length }
        : { url, ok: false, error: page?.error ?? 'not fetched' };
    }),
  };
}

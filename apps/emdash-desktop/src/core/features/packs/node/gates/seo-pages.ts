import {
  DEFAULT_FUZZY_THRESHOLD,
  extractReadableText,
  looksLikeHtml,
  matchQuote,
  type FetchText,
} from '@emdash/citations';
import type { SeoFindings } from './seo-findings';

/**
 * The reviewer runs with read-only tools and no network, so the gate fetches
 * the pages cited as crawl or citation evidence itself, through the app's
 * SSRF-safe `fetchText`, and hands their text to the reviewer inside fences.
 * Citation quotes are also checked here, deterministically, so a missing
 * quote fails the finding whatever the reviewer says.
 */

export const MAX_FETCHED_PAGES = 20;
/** Characters of each page shown to the reviewer. Quote checks use the whole page. */
export const MAX_PAGE_PROMPT_CHARS = 12_000;

export interface FetchedPage {
  url: string;
  /** Readable text; undefined when the fetch failed or was skipped. */
  text?: string;
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function citedUrls(doc: SeoFindings): string[] {
  const urls = doc.findings.flatMap((f) =>
    f.evidence.flatMap((e) => (e.type === 'crawl' || e.type === 'citation' ? [e.url] : []))
  );
  return [...new Set(urls)];
}

export async function fetchCitedPages(
  doc: SeoFindings,
  fetchText: FetchText,
  signal: AbortSignal
): Promise<FetchedPage[]> {
  const urls = citedUrls(doc);
  return Promise.all(
    urls.map(async (url, i): Promise<FetchedPage> => {
      if (i >= MAX_FETCHED_PAGES) {
        return { url, error: `not fetched: more than ${MAX_FETCHED_PAGES} cited pages` };
      }
      try {
        const body = await fetchText(url, { signal });
        return { url, text: looksLikeHtml(body) ? extractReadableText(body) : body };
      } catch (error) {
        return { url, error: errorMessage(error) };
      }
    })
  );
}

/**
 * Citation quotes that the fetched page does not contain, by finding id.
 * A page that could not be fetched is left to the reviewer (usually unverifiable).
 */
export function citationProblems(doc: SeoFindings, pages: FetchedPage[]): Map<string, string[]> {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const problems = new Map<string, string[]>();
  for (const finding of doc.findings) {
    for (const evidence of finding.evidence) {
      if (evidence.type !== 'citation') continue;
      const text = byUrl.get(evidence.url)?.text;
      if (text === undefined) continue;
      const { score } = matchQuote(evidence.quote, text);
      if (score >= DEFAULT_FUZZY_THRESHOLD) continue;
      const list = problems.get(finding.id) ?? [];
      list.push(`the quoted text is not on ${evidence.url} (best match ${score.toFixed(2)})`);
      problems.set(finding.id, list);
    }
  }
  return problems;
}

export function pageForPrompt(page: FetchedPage): string {
  if (page.text === undefined) return `URL: ${page.url}\nFETCH FAILED: ${page.error ?? 'unknown'}`;
  const text =
    page.text.length > MAX_PAGE_PROMPT_CHARS
      ? `${page.text.slice(0, MAX_PAGE_PROMPT_CHARS)}\n[truncated]`
      : page.text;
  return `URL: ${page.url}\n${text}`;
}

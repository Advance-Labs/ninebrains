# @emdash/citations

Checks whether the claims an agent makes are backed by the sources it was given. Each claim comes out **grounded**, **imprecise**, **invented** or **uncited**.

Generalised from Advance Labs' BuildCode citation validator (2026). Lucas Krawczak cleared it for reuse on 2026-09-10, and it ships here under Apache-2.0. None of BuildCode's corpus, client data or fixtures is included.

## API

```ts
validateClaims(claims: Claim[], retrievedSources: Source[], options?): ValidationResult
verifyUrlClaims(claims: Claim[], { fetchText, sources?, concurrency?, signal?, ...options }): Promise<UrlVerificationResult>
matchQuote(quote, sourceText): { score, exact }
extractReadableText(html): string
precisionAtK(runs, k) · hitRateAtK(runs, k) · validatorPassRate(results) · qualityReport(runs, results, k)
parseClaimsDocument(json): { claims, sources }   // boundary validation for claims.json
createDefaultFetchText({ timeoutMs, maxBytes }) · defaultFetchText
```

`Source { id, url?, title?, hierarchy?: string[], text }` · `Claim { text, citations: { sourceId, quote?, locator? }[] }`

## Verdicts

| Status | Meaning |
|---|---|
| grounded | The cited source was retrieved, and any quote appears in it verbatim after normalisation, or at or above `fuzzyThreshold` (0.85) similarity. |
| imprecise | Something real was cited, but not exactly. Three cases: the cited node is an ancestor or descendant of a retrieved source (hierarchy strategy); the quote appears in a *different* retrieved source; or the quote scores between `looseThreshold` (0.6) and `fuzzyThreshold`. |
| invented | Nothing retrieved backs the citation. |
| uncited | The claim has no citations. |

- A claim takes the worst verdict among its citations.
- `summary.pass` is true when no claim is invented or uncited; imprecise claims do not fail it.
- `summary.passRate` is grounded divided by total.

**Hierarchy strategy.** This only applies to retrieved sources that carry a `hierarchy`. By default a citation's path is `sourceId.split('/')`. Override it with `hierarchySeparator` or `citationPath`.

**Quote matching.** Text is normalised before matching: NFKC, lower-cased, punctuation and symbols removed, whitespace collapsed. Matching then tries an exact substring first. If that fails, it compares the quote with each same-length token window in the source using token-level edit distance. Only windows that share at least half the quote's vocabulary are compared, which keeps matching fast on long pages.

## URL verification

`verifyUrlClaims` fetches each cited URL once and extracts its readable text. Tags are stripped without a parser dependency; script, style and head content is dropped and entities are decoded. It then checks every quote against the page.

- A URL comes from the `sources` catalog (id → url), or from the `sourceId` when that is itself an http(s) URL.
- A quote is required (`requireQuote` defaults to true here): without one, a citation is at best imprecise.
- **A fetch failure makes the citation invented**, with the error in `reasons`. A claim that can't be verified is not treated as grounded.

> ⚠️ `defaultFetchText` does not protect against SSRF. It only allows http(s), with a 10 s timeout and a 2 MB cap. It does not block private addresses or DNS rebinding, so the app must inject its net-guard fetcher for untrusted URLs.

## Report the two numbers separately

The validator proves that a cited source was *retrieved*. It cannot prove that source was the *right* one. `qualityReport` therefore returns precision@k (and hit-rate@k) next to the validator pass rate, and never combines them into one score. `metrics.test.ts` covers the key case: retrieval returns the wrong document and the validator still passes.

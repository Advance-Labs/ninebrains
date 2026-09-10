/**
 * Fact-check gate: every claim in the worker's `claims.json` must be backed by
 * a source that actually contains what it quotes.
 *
 * Default mode is `url`: each cited URL is fetched through the injected
 * `fetchText` (the app's SSRF-safe fetcher) and quotes are checked against the
 * live page. Source text the agent pastes into claims.json is ignored in this
 * mode, because an agent can forge it. `sources` mode validates against a
 * retrieved set the app supplies from a trusted place (e.g. a retrieval log).
 *
 * Invented and uncited claims fail the gate. Imprecise claims pass with a
 * warning: they cite something real, just not exactly.
 */

import {
  parseClaimsDocument,
  validateClaims,
  verifyUrlClaims,
  type ClaimVerdict,
  type Source,
  type ValidationResult,
} from '@emdash/citations';
import type { Gate, GateContext, GateTask } from '../types';
import { errorMessage, isSafeRelativePath } from '../util';

export interface FactCheckGateOptions {
  /** Worktree-relative path. Default 'claims.json'. */
  claimsPath?: string;
  mode?: 'url' | 'sources';
  /** Required in `sources` mode: the trusted retrieved set. */
  loadSources?: (ctx: GateContext) => Promise<Source[]>;
  fuzzyThreshold?: number;
  looseThreshold?: number;
  appliesTo?: (task: GateTask) => boolean;
}

const MAX_LISTED = 10;

const FORMAT_HINT =
  'Expected {"claims": [{"text": "...", "citations": [{"sourceId": "https://...", ' +
  '"quote": "exact words from that page"}]}]}.';

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function listClaims(verdicts: ClaimVerdict[]): string {
  const lines = verdicts
    .slice(0, MAX_LISTED)
    .map((v) => `- "${oneLine(v.claim.text)}" → ${v.status}: ${v.reasons[0] ?? 'no reason given'}`);
  if (verdicts.length > MAX_LISTED) lines.push(`- … and ${verdicts.length - MAX_LISTED} more`);
  return lines.join('\n');
}

export function factCheckGate(options: FactCheckGateOptions = {}): Gate {
  const claimsPath = options.claimsPath ?? 'claims.json';
  if (!isSafeRelativePath(claimsPath)) {
    throw new Error(
      `factCheckGate claimsPath must be a relative path inside the worktree: ${claimsPath}`
    );
  }
  const mode = options.mode ?? 'url';
  const loadSources = options.loadSources;
  if (mode === 'sources' && !loadSources)
    throw new Error('factCheckGate sources mode needs loadSources');
  const thresholds = {
    fuzzyThreshold: options.fuzzyThreshold,
    looseThreshold: options.looseThreshold,
  };

  return {
    id: 'fact-check',
    title: 'Fact check',
    appliesTo: options.appliesTo ?? ((task) => task.kind === 'research' || task.kind === 'seo'),
    async run(ctx) {
      let raw: string;
      try {
        raw = await ctx.capabilities.readWorktreeFile(claimsPath, { signal: ctx.signal });
      } catch (error) {
        return {
          pass: false,
          evidence: [],
          feedback: `Could not read ${claimsPath}: ${errorMessage(error)}. ${FORMAT_HINT}`,
        };
      }

      let doc;
      try {
        doc = parseClaimsDocument(JSON.parse(raw));
      } catch (error) {
        return {
          pass: false,
          evidence: [],
          feedback: `${claimsPath} is invalid: ${errorMessage(error)}. ${FORMAT_HINT}`,
        };
      }
      if (doc.claims.length === 0) {
        return {
          pass: false,
          evidence: [],
          feedback: `${claimsPath} contains no claims. ${FORMAT_HINT}`,
        };
      }

      let result: ValidationResult & { fetches?: unknown };
      try {
        result =
          mode === 'url'
            ? await verifyUrlClaims(doc.claims, {
                ...thresholds,
                fetchText: ctx.capabilities.fetchText,
                // Only the id → url mapping is used; pasted source text is untrusted.
                sources: doc.sources.map(({ id, url, title }) => ({ id, url, title })),
                signal: ctx.signal,
              })
            : validateClaims(doc.claims, await loadSources!(ctx), thresholds);
      } catch (error) {
        return {
          pass: false,
          evidence: [],
          feedback: `Fact check could not run: ${errorMessage(error)}`,
        };
      }

      const { summary } = result;
      const report = await ctx.evidence.put({
        kind: 'json',
        label: 'Fact-check report',
        fileName: 'fact-check.json',
        data: JSON.stringify(
          {
            mode,
            summary,
            perClaim: result.perClaim.map((v) => ({
              text: v.claim.text,
              status: v.status,
              reasons: v.reasons,
              citations: v.citations.map((c) => ({
                sourceId: c.citation.sourceId,
                status: c.status,
                quoteScore: c.quoteScore,
                reasons: c.reasons,
              })),
            })),
            fetches: result.fetches,
          },
          null,
          2
        ),
      });

      const metrics = {
        claims: summary.total,
        grounded: summary.grounded,
        imprecise: summary.imprecise,
        invented: summary.invented,
        uncited: summary.uncited,
        passRate: summary.passRate,
      };
      const imprecise = result.perClaim.filter((v) => v.status === 'imprecise');
      const warning = imprecise.length
        ? `\n\n${imprecise.length} claim(s) are imprecise and worth tightening:\n${listClaims(imprecise)}`
        : '';

      if (summary.pass) {
        return {
          pass: true,
          evidence: [report],
          feedback: `All ${summary.total} claims are supported.${warning}`,
          metrics,
        };
      }
      const bad = result.perClaim.filter((v) => v.status === 'invented' || v.status === 'uncited');
      return {
        pass: false,
        evidence: [report],
        feedback:
          `${bad.length} of ${summary.total} claims are unsupported. Cite a source that actually ` +
          `contains the quoted text, or remove the claim:\n${listClaims(bad)}${warning}`,
        metrics,
      };
    },
  };
}

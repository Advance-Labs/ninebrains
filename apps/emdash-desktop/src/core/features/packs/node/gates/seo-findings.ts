import { z } from 'zod';

/**
 * `seo-findings.json`: the SEO team's output. Every recommendation carries
 * evidence the seo-evidence gate can re-check: a search-data query (tool,
 * args, and the numbers cited), a crawl finding with its URL, or a citation.
 */

const MAX_ARGS_JSON = 4000;

const webUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

export const queryEvidenceSchema = z.strictObject({
  type: z.literal('query'),
  server: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .default('aeo-search'),
  tool: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  args: z
    .record(z.string(), z.unknown())
    .refine((a) => JSON.stringify(a).length <= MAX_ARGS_JSON, 'args are too large'),
  observed: z
    .record(z.string().min(1).max(64), z.number().finite())
    .refine((o) => Object.keys(o).length > 0, 'cite at least one number the query returned'),
  note: z.string().max(500).optional(),
});

export const crawlEvidenceSchema = z.strictObject({
  type: z.literal('crawl'),
  url: webUrl,
  observation: z.string().trim().min(1).max(1000),
});

export const citationEvidenceSchema = z.strictObject({
  type: z.literal('citation'),
  url: webUrl,
  quote: z.string().trim().min(1).max(1000),
});

export const seoEvidenceSchema = z.discriminatedUnion('type', [
  queryEvidenceSchema,
  crawlEvidenceSchema,
  citationEvidenceSchema,
]);

export const seoFindingSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
  title: z.string().trim().min(1).max(200),
  recommendation: z.string().trim().min(1).max(2000),
  severity: z.enum(['high', 'medium', 'low']).optional(),
  owner: z.string().max(64).optional(),
  evidence: z.array(seoEvidenceSchema).min(1, 'every finding needs evidence').max(10),
});

export const seoFindingsSchema = z
  .strictObject({
    site: webUrl,
    findings: z.array(seoFindingSchema).min(1, 'no findings').max(100),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    for (const finding of doc.findings) {
      if (seen.has(finding.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['findings'],
          message: `duplicate id "${finding.id}"`,
        });
      }
      seen.add(finding.id);
    }
  });

export type SeoFinding = z.infer<typeof seoFindingSchema>;
export type SeoFindings = z.infer<typeof seoFindingsSchema>;

export const SEO_VERDICTS = ['confirmed', 'contradicted', 'unverifiable'] as const;
export type SeoVerdictStatus = (typeof SEO_VERDICTS)[number];

export interface SeoVerdict {
  id: string;
  status: SeoVerdictStatus;
  note: string;
}

const replySchema = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      id: z.string(),
      status: z.enum(SEO_VERDICTS),
      note: z.string().trim().min(1).max(2000),
    })
  ),
});

const FENCED = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/**
 * Strict parse of the reviewer's reply: one JSON object (optionally in a
 * single ```json fence), one verdict per finding, no unknown or repeated ids.
 */
export function parseSeoReview(
  text: string,
  findingIds: readonly string[]
): { ok: true; verdicts: SeoVerdict[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  const body = FENCED.exec(trimmed)?.[1] ?? trimmed;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, error: 'reply is not a single JSON object' };
  }
  const parsed = replySchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join('.') || 'reply'}: ${issue?.message}` };
  }

  const expected = new Set(findingIds);
  const seen = new Set<string>();
  for (const verdict of parsed.data.verdicts) {
    if (!expected.has(verdict.id))
      return { ok: false, error: `unknown finding id "${verdict.id}"` };
    if (seen.has(verdict.id)) return { ok: false, error: `finding "${verdict.id}" judged twice` };
    seen.add(verdict.id);
  }
  const missing = findingIds.filter((id) => !seen.has(id));
  if (missing.length) return { ok: false, error: `no verdict for ${missing.join(', ')}` };
  return { ok: true, verdicts: parsed.data.verdicts };
}

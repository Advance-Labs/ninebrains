import { z } from 'zod';
import { modelIdSchema } from './subagent-model';

/**
 * A model profile (Lever B, plan §4.2): a vendor endpoint the user reaches with their own API
 * key, or a model server on this machine. The key never appears in any of these shapes (SEC-40):
 * the renderer only learns `hasKey`. SEC-44: only these credential kinds exist; there is no
 * OAuth, cookie, session or token-file kind, and a vendor host must be on `vendors.json`
 * (checked in main, `node/vendors.ts`).
 */

/** SEC-14: a profile id becomes a keychain entry name. */
export const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const profileIdSchema = z.string().regex(PROFILE_ID, 'must be letters, digits, - or _');

export const PROFILE_KINDS = [
  'anthropic-api',
  'openai-api',
  'anthropic-compatible',
  'openai-responses-compatible',
  'bedrock',
  'vertex',
  'foundry',
  'local',
] as const;
export const profileKindSchema = z.enum(PROFILE_KINDS);
export type ProfileKind = z.infer<typeof profileKindSchema>;

/** Claude Code's native cloud switches need cloud credentials we don't hold yet (wave 2). */
export const DEFERRED_KINDS: readonly ProfileKind[] = ['bedrock', 'vertex', 'foundry'];

/** `anthropic`: `/v1/messages` for Claude Code. `openai-responses`: `/v1/responses` for Codex. */
export const profileProtocolSchema = z.enum(['anthropic', 'openai-responses']);
export type ProfileProtocol = z.infer<typeof profileProtocolSchema>;

export const profileTierSchema = z.enum(['cheap', 'standard', 'strong']);
export type ProfileTier = z.infer<typeof profileTierSchema>;

/** The protocol a kind speaks; `local` speaks either, so it names one. */
export function protocolOfKind(kind: ProfileKind): ProfileProtocol | null {
  switch (kind) {
    case 'anthropic-api':
    case 'anthropic-compatible':
    case 'bedrock':
    case 'vertex':
    case 'foundry':
      return 'anthropic';
    case 'openai-api':
    case 'openai-responses-compatible':
      return 'openai-responses';
    case 'local':
      return null;
  }
}

/** Model ids for Claude Code's aliases (`ANTHROPIC_DEFAULT_*_MODEL`). */
export const tierModelsSchema = z.strictObject({
  opus: modelIdSchema.optional(),
  sonnet: modelIdSchema.optional(),
  haiku: modelIdSchema.optional(),
});
export type TierModels = z.infer<typeof tierModelsSchema>;

/** USD per million tokens. Null is unpriced: such a profile can't run unattended (SEC-43, R5). */
const usdPerMTok = z.number().min(0).max(10_000).nullable();
export const profilePriceSchema = z.strictObject({
  inPerMTok: usdPerMTok,
  outPerMTok: usdPerMTok,
  cacheReadPerMTok: usdPerMTok,
  cacheWritePerMTok: usdPerMTok,
});
export type ProfilePrice = z.infer<typeof profilePriceSchema>;
export const UNPRICED: ProfilePrice = {
  inPerMTok: null,
  outPerMTok: null,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Consumer login hosts: a profile never points at them, whatever `vendors.json` says (SEC-44). */
const LOGIN_HOSTS = ['claude.ai', 'chatgpt.com', 'chat.openai.com', 'auth.openai.com'];

export function isLoginHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return LOGIN_HOSTS.some((login) => host === login || host.endsWith(`.${login}`));
}

/**
 * Why a base URL is not acceptable for a kind, or null. Remote kinds need https (the key
 * travels in a header) and no consumer login host. `local` stays on this machine. No
 * credentials, query or fragment: each is a way to smuggle a secret or a second destination.
 * The vendor-host allowlist is checked separately, in main.
 */
export function baseUrlProblem(raw: string, kind: ProfileKind): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'is not a URL';
  }
  if (url.username || url.password) return 'must not contain a user name or password';
  if (url.search || url.hash) return 'must not have a query or fragment';
  if (isLoginHost(url.hostname)) return 'is a consumer login site, not an API';
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (kind === 'local') {
    if (!loopback) return 'must be on this machine (127.0.0.1, localhost or [::1])';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must be http or https';
    return null;
  }
  if (url.protocol !== 'https:') return 'must be https';
  if (loopback) return 'points at this machine; use a local profile instead';
  return null;
}

/** Trailing slashes are dropped, since the CLIs join paths onto the base. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export const modelProfileInputSchema = z
  .strictObject({
    /** Absent: create a profile. Present: update that profile. */
    id: profileIdSchema.optional(),
    label: z.string().trim().min(1).max(80),
    kind: profileKindSchema,
    /** A `vendors.json` id. Required for every kind but `local`. */
    vendorId: z.string().regex(PROFILE_ID).optional(),
    /** Required for `local`; must match the kind otherwise. */
    protocol: profileProtocolSchema.optional(),
    baseUrl: z.string().trim().min(1).max(2048).transform(normalizeBaseUrl),
    /** The main model: `--model` for runs, and the alias target when no tier model is set. */
    model: modelIdSchema.optional(),
    tierModels: tierModelsSchema.optional(),
    tier: profileTierSchema.default('standard'),
    price: profilePriceSchema.optional(),
    contextWindow: z.number().int().min(1024).max(10_000_000).nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((profile, ctx) => {
    const problem = baseUrlProblem(profile.baseUrl, profile.kind);
    if (problem)
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: `Base URL ${problem}` });
    const fixed = protocolOfKind(profile.kind);
    if (fixed === null && !profile.protocol) {
      ctx.addIssue({
        code: 'custom',
        path: ['protocol'],
        message: 'A local profile names its protocol',
      });
    }
    if (fixed !== null && profile.protocol && profile.protocol !== fixed) {
      ctx.addIssue({
        code: 'custom',
        path: ['protocol'],
        message: `${profile.kind} speaks ${fixed}`,
      });
    }
    if (profile.kind !== 'local' && !profile.vendorId) {
      ctx.addIssue({ code: 'custom', path: ['vendorId'], message: 'Pick a vendor from the list' });
    }
  });
export type ModelProfileInput = z.input<typeof modelProfileInputSchema>;
export type ParsedProfileInput = z.output<typeof modelProfileInputSchema>;

export const modelProfileSchema = z.object({
  id: profileIdSchema,
  label: z.string(),
  kind: profileKindSchema,
  vendorId: z.string().nullable(),
  protocol: profileProtocolSchema,
  baseUrl: z.string(),
  model: z.string().optional(),
  tierModels: tierModelsSchema,
  tier: profileTierSchema,
  price: profilePriceSchema,
  contextWindow: z.number().nullable(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ModelProfile = z.infer<typeof modelProfileSchema>;

/** What the renderer sees. `hasKey` is the only thing it ever learns about the key. */
export const modelProfileViewSchema = modelProfileSchema.extend({
  hasKey: z.boolean(),
  /**
   * True for an `anthropic` profile whose host is not Anthropic's: Anthropic does not support
   * Claude Code on non-Claude models, so the UI says "not supported by Anthropic" (plan §7).
   */
  unsupported: z.boolean(),
  /** In and out prices are both set. */
  priced: z.boolean(),
});
export type ModelProfileView = z.infer<typeof modelProfileViewSchema>;

export function isUnsupportedProfile(profile: Pick<ModelProfile, 'protocol' | 'baseUrl'>): boolean {
  if (profile.protocol !== 'anthropic') return false;
  try {
    return new URL(profile.baseUrl).hostname !== 'api.anthropic.com';
  } catch {
    return true;
  }
}

export function isPriced(price: ProfilePrice): boolean {
  return price.inPerMTok !== null && price.outPerMTok !== null;
}

/** A reviewed vendor from `vendors.json`, as the renderer's picker sees it. */
export const vendorSchema = z.strictObject({
  id: z.string().regex(PROFILE_ID),
  label: z.string().min(1).max(80),
  kinds: z.array(profileKindSchema).min(1),
  protocols: z.array(profileProtocolSchema).min(1),
  hosts: z.array(z.string().min(1).max(253)).min(1),
  baseUrls: z.partialRecord(profileProtocolSchema, z.string().url()),
  docsUrl: z.string().url(),
  /** Null when R0 did not read the vendor's terms page. */
  termsUrl: z.string().url().nullable(),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(400).optional(),
});
export type Vendor = z.infer<typeof vendorSchema>;

/** A key is one opaque token: 8 to 4096 visible characters, no spaces or control characters. */
export const profileKeySchema = z
  .string()
  .trim()
  .min(8, 'is too short to be an API key')
  .max(4096)
  .regex(/^[\x21-\x7e]+$/, 'must be one token with no spaces');

import { defineContract, fallible, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { PACK_LICENCE_ALLOWLIST, ROLE_KINDS } from './pack-schema';

export const packsDomain = 'packs' as const;

const licence = z.enum(PACK_LICENCE_ALLOWLIST);

export const packSecretStatusSchema = z.object({
  name: z.string(),
  description: z.string(),
  howToGet: z.string(),
  optional: z.boolean(),
  present: z.boolean(),
  /** Where the user sets it, as described by the app's secret resolver. */
  location: z.string(),
  /** Set in the app's keychain (so it can be cleared here). Never the value itself. */
  storedInApp: z.boolean(),
});

/** Pack secret names: what `requiredSecrets` may declare. */
export const packSecretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);

export const packSummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  license: licence,
  source: z.enum(['bundled', 'user']),
  enabled: z.boolean(),
  roles: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(ROLE_KINDS),
      /** The role's preferred agent and model, used to prefill the add-lane form. */
      provider: z.enum(['claude', 'codex']).optional(),
      model: z.string().optional(),
    })
  ),
  mcpServers: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      license: licence,
      optional: z.boolean(),
      homepage: z.string(),
      transport: z.enum(['stdio', 'http']),
    })
  ),
  catalogLinks: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      url: z.string(),
      auth: z.enum(['oauth', 'none']),
    })
  ),
  skills: z.array(z.object({ id: z.string(), installId: z.string(), source: z.string() })),
  gates: z.array(z.string()),
  secrets: z.array(packSecretStatusSchema),
  /** Overridable settings such as AEO_MCP_BASE_URL. */
  settings: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      default: z.string(),
      location: z.string(),
      overridden: z.boolean(),
    })
  ),
  /** What leaves the machine with the current settings. Empty when nothing is disclosed. */
  disclosures: z.array(z.string()),
});

export const packLoadErrorSchema = z.object({
  source: z.enum(['bundled', 'user']),
  /** Null when the pack's id could not be read. */
  packId: z.string().nullable(),
  location: z.string(),
  message: z.string(),
});

export const packsListingSchema = z.object({
  packs: z.array(packSummarySchema),
  errors: z.array(packLoadErrorSchema),
});

export const packsErrorSchema = z.object({
  type: z.enum(['unknown-pack', 'persistence', 'unknown-secret', 'secret-store']),
  message: z.string(),
});

export const packsContract = defineContract({
  list: procedure({
    input: z.object({ projectId: z.string().min(1).nullable() }),
    output: packsListingSchema,
  }),
  setEnabled: fallible({
    input: z.object({
      projectId: z.string().min(1),
      packId: z.string().min(1),
      enabled: z.boolean(),
    }),
    data: z.object({ enabledPackIds: z.array(z.string()) }),
    error: packsErrorSchema,
  }),
  /**
   * Stores a pack secret in the app keychain. Write-only: no procedure returns a value, and
   * `list` reports only `present` / `storedInApp`.
   */
  setSecret: fallible({
    input: z.object({ name: packSecretNameSchema, value: z.string().min(1).max(16_384) }),
    data: z.void(),
    error: packsErrorSchema,
  }),
  clearSecret: fallible({
    input: z.object({ name: packSecretNameSchema }),
    data: z.void(),
    error: packsErrorSchema,
  }),
});

export type PacksContract = typeof packsContract;
export type PackSummary = z.infer<typeof packSummarySchema>;
export type PackSecretStatus = z.infer<typeof packSecretStatusSchema>;
export type PackLoadError = z.infer<typeof packLoadErrorSchema>;
export type PacksListing = z.infer<typeof packsListingSchema>;
export type PacksError = z.infer<typeof packsErrorSchema>;

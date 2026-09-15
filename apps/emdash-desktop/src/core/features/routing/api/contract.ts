import { defineContract, fallible, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  modelProfileInputSchema,
  modelProfileViewSchema,
  profileIdSchema,
  profileKeySchema,
  vendorSchema,
} from './profile';

export const routingDomain = 'routing' as const;

export const routingErrorSchema = z.object({
  type: z.enum(['disabled', 'not-found', 'invalid', 'secret-store', 'persistence']),
  message: z.string(),
});
export type RoutingError = z.infer<typeof routingErrorSchema>;

export const connectionTestSchema = z.object({
  status: z.enum(['ok', 'auth-failed', 'not-found', 'rate-limited', 'unreachable', 'error']),
  /** The HTTP status, when the server answered. */
  httpStatus: z.number().nullable(),
  /** Plain words for the settings page. Never carries the key or the response body. */
  message: z.string(),
  /** How many models the server listed, when it did. */
  modelCount: z.number().nullable(),
});
export type ConnectionTest = z.infer<typeof connectionTestSchema>;

export const profilesListingSchema = z.object({
  /** `MODEL_PROFILES_ENABLED`: false in release builds until Lucas decides (plan §9.1). */
  enabled: z.boolean(),
  profiles: z.array(modelProfileViewSchema),
  /** The reviewed vendor allowlist (SEC-44), for the picker. */
  vendors: z.array(vendorSchema),
});
export type ProfilesListing = z.infer<typeof profilesListingSchema>;

const profileKey = z.object({ profileId: profileIdSchema });

/** Which auth mode a role (worker/subagent/reviewer) will actually run under, in plain terms. */
export const agentRoleModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subscription') }),
  z.object({ kind: z.literal('profile'), profileLabel: z.string(), tier: z.string() }),
  z.object({ kind: z.literal('blocked'), reason: z.string() }),
]);
export type AgentRoleMode = z.infer<typeof agentRoleModeSchema>;

/**
 * Read-only visibility (Lucas's "oauth tools the user has" ask, `docs/plans/2026-09-15-routing-usability.md`):
 * is the CLI installed, and what will each role actually run under. Never reads a credential file
 * and spawns nothing new — D5. Roles are not provider-scoped today (`resolveRoute` isn't either),
 * so `worker`/`subagent`/`reviewer` mode is identical for `claude` and `codex`; see
 * `routing-service.ts`'s `agentCliStatus`.
 */
export const agentCliStatusSchema = z.object({
  provider: z.enum(['claude', 'codex']),
  installed: z.boolean(),
  path: z.string().nullable(),
  roles: z.array(
    z.object({
      role: z.enum(['worker', 'subagent', 'reviewer']),
      mode: agentRoleModeSchema,
    })
  ),
});
export type AgentCliStatusEntry = z.infer<typeof agentCliStatusSchema>;

/**
 * Settings → Models. SEC-40: the renderer can set, replace, test and delete a key, and never
 * read one. No procedure returns a key; `listProfiles` reports only `hasKey`.
 */
export const routingContract = defineContract({
  listProfiles: procedure({ input: z.object({}), output: profilesListingSchema }),
  /** Read-only: which CLIs are installed and which auth mode each role will run under. */
  agentCliStatus: procedure({ input: z.object({}), output: z.array(agentCliStatusSchema) }),
  saveProfile: fallible({
    input: modelProfileInputSchema,
    data: z.object({ profileId: z.string() }),
    error: routingErrorSchema,
  }),
  /** Write-only. Replaces any key the profile had. */
  setProfileKey: fallible({
    input: profileKey.extend({ key: profileKeySchema }),
    data: z.void(),
    error: routingErrorSchema,
  }),
  clearProfileKey: fallible({ input: profileKey, data: z.void(), error: routingErrorSchema }),
  /** Deletes the profile and its key. Lanes that used it fail to launch until switched. */
  deleteProfile: fallible({ input: profileKey, data: z.void(), error: routingErrorSchema }),
  /** One GET of the model list, from main, never from the renderer. */
  testConnection: fallible({
    input: profileKey,
    data: connectionTestSchema,
    error: routingErrorSchema,
  }),
});

export type RoutingContract = typeof routingContract;

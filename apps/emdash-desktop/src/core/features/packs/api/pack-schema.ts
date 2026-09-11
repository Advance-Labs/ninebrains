import { z } from 'zod';

/**
 * `pack.json` — a discipline pack: lane roles, skills, MCP servers and gates.
 *
 * Packs are untrusted input (user packs come from disk), so the schema is
 * strict: unknown keys are rejected, every string is bounded, and secrets are
 * only ever referenced by name (`{ "secret": "NAME" }`), never stored.
 */

export const PACK_LICENCE_ALLOWLIST = [
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
] as const;

export const ROLE_KINDS = ['code', 'ui', 'research', 'seo', 'video'] as const;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const GATE_ID = /^[a-z][a-z0-9-]{1,40}$/;
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]{1,63})\}\}/g;

const slug = (what: string) =>
  z
    .string()
    .regex(SLUG, `${what} must be lower-case letters, digits and single dashes`)
    .refine((value) => !value.includes('--'), `${what} must not contain "--"`);
const text = (max: number) => z.string().trim().min(1).max(max);

export const licenceSchema = z.enum(PACK_LICENCE_ALLOWLIST);

function isAllowedUrl(value: string, allowLoopbackHttp: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return allowLoopbackHttp && url.protocol === 'http:' && loopback;
}

/** https anywhere, or http on localhost (a self-hosted server on this machine). */
export function isAllowedServerUrl(value: string): boolean {
  return isAllowedUrl(value, true);
}

/** Names of the `{{NAME}}` settings a server URL uses. */
export function urlPlaceholders(url: string): string[] {
  return [...url.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/** Base URLs are joined with a path, so a trailing slash is dropped. */
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function fillUrlTemplate(url: string, values: Readonly<Record<string, string>>): string {
  return url.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');
}

const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => isAllowedUrl(v, false), 'must be an https URL');
const serverUrl = z
  .string()
  .max(2048)
  .refine((v) => isAllowedUrl(v, true), 'must be https (or http on localhost)');

/** A reference to a secret resolved at launch time. The value never lives in the pack. */
export const secretRefSchema = z.strictObject({
  secret: z.string().regex(SECRET_NAME, 'secret names are UPPER_SNAKE_CASE'),
  /** Prepended to the resolved value, e.g. "Bearer ". */
  prefix: z.string().max(32).optional(),
  /** When true a missing secret drops just this value, not the whole server. */
  optional: z.boolean().optional(),
});
export type SecretRef = z.infer<typeof secretRefSchema>;

const valueSchema = z.union([z.string().max(4096), secretRefSchema]);
export type PackValue = z.infer<typeof valueSchema>;

export const roleSchema = z.strictObject({
  id: slug('role id'),
  title: text(80),
  kind: z.enum(ROLE_KINDS),
  systemPrompt: z.string().trim().min(20).max(20_000),
  provider: z.enum(['claude', 'codex']).optional(),
  model: text(80).optional(),
  gates: z.array(z.string().regex(GATE_ID)).max(10),
});
export type PackRole = z.infer<typeof roleSchema>;

const serverBase = {
  name: slug('server name'),
  description: text(400),
  optional: z.boolean(),
  homepage: httpsUrl,
  license: licenceSchema,
};

export const stdioServerSchema = z.strictObject({
  ...serverBase,
  transport: z.literal('stdio'),
  command: z.string().regex(/^[A-Za-z0-9._@/-]{1,128}$/, 'command must be a bare program name'),
  args: z.array(valueSchema).max(32),
  env: z.record(z.string().regex(ENV_NAME), valueSchema),
});

export const httpServerSchema = z.strictObject({
  ...serverBase,
  transport: z.literal('http'),
  /** May use `{{SETTING}}` placeholders; the filled URL is re-validated at launch. */
  url: z.string().max(2048).regex(/^\S+$/, 'url must not contain whitespace'),
  headers: z.record(z.string().regex(HEADER_NAME), valueSchema),
});

export const packMcpServerSchema = z.discriminatedUnion('transport', [
  stdioServerSchema,
  httpServerSchema,
]);
export type PackMcpServer = z.infer<typeof packMcpServerSchema>;

export const packSkillSchema = z.strictObject({
  id: slug('skill id'),
  /** Pack-relative path of the SKILL.md. */
  path: z
    .string()
    .regex(/^[A-Za-z0-9._/-]{1,200}$/)
    .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must stay inside the pack')
    .refine((p) => p.endsWith('SKILL.md'), 'must point at a SKILL.md'),
  license: licenceSchema,
  /** Upstream origin, kept for attribution. */
  source: text(300),
});
export type PackSkill = z.infer<typeof packSkillSchema>;

export const requiredSecretSchema = z.strictObject({
  name: z.string().regex(SECRET_NAME),
  description: text(300),
  howToGet: text(500),
  /** Optional secrets unlock extra tools; the pack still works without them. */
  optional: z.boolean(),
});
export type RequiredSecret = z.infer<typeof requiredSecretSchema>;

/**
 * A non-secret value the user may override (read through the same resolver as
 * secrets), e.g. the base URL of a self-hosted server.
 */
export const packSettingSchema = z.strictObject({
  name: z.string().regex(SECRET_NAME),
  description: text(300),
  default: serverUrl,
  /** Shown in the UI while the default is in use: what leaves the machine, and to whom. */
  defaultDisclosure: text(800).optional(),
});
export type PackSetting = z.infer<typeof packSettingSchema>;

/** A hosted server the user connects to themselves (OAuth). Shown as a link only. */
export const catalogLinkSchema = z.strictObject({
  name: text(80),
  description: text(300),
  url: httpsUrl,
  auth: z.enum(['oauth', 'none']),
});

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((v) => (seen.has(v) ? true : (seen.add(v), false))))];
}

function secretRefs(server: PackMcpServer): SecretRef[] {
  const values: PackValue[] =
    server.transport === 'stdio'
      ? [...server.args, ...Object.values(server.env)]
      : Object.values(server.headers);
  return values.filter((v): v is SecretRef => typeof v !== 'string');
}

export const packSchema = z
  .strictObject({
    id: slug('pack id'),
    version: z.string().regex(SEMVER, 'version must be semver'),
    title: text(80),
    description: text(800),
    license: licenceSchema,
    roles: z.array(roleSchema).min(1).max(20),
    skills: z.array(packSkillSchema).max(40),
    mcpServers: z.array(packMcpServerSchema).max(20),
    gates: z.array(z.string().regex(GATE_ID)).max(10),
    requiredSecrets: z.array(requiredSecretSchema).max(20),
    settings: z.array(packSettingSchema).max(10).optional(),
    catalogLinks: z.array(catalogLinkSchema).max(20).optional(),
  })
  .superRefine((pack, ctx) => {
    const unique = (label: string, path: string, values: string[]) => {
      for (const dup of duplicates(values)) {
        ctx.addIssue({ code: 'custom', path: [path], message: `duplicate ${label} "${dup}"` });
      }
    };
    const settings = pack.settings ?? [];
    unique(
      'role id',
      'roles',
      pack.roles.map((r) => r.id)
    );
    unique(
      'skill id',
      'skills',
      pack.skills.map((s) => s.id)
    );
    unique(
      'server name',
      'mcpServers',
      pack.mcpServers.map((s) => s.name)
    );
    unique('secret or setting', 'requiredSecrets', [
      ...pack.requiredSecrets.map((s) => s.name),
      ...settings.map((s) => s.name),
    ]);

    const declared = new Set(pack.requiredSecrets.map((s) => s.name));
    const defaults = Object.fromEntries(settings.map((s) => [s.name, normalizeBaseUrl(s.default)]));
    for (const server of pack.mcpServers) {
      for (const ref of secretRefs(server)) {
        if (!declared.has(ref.secret)) {
          ctx.addIssue({
            code: 'custom',
            path: ['mcpServers'],
            message: `server "${server.name}" uses secret ${ref.secret}, which requiredSecrets does not declare`,
          });
        }
      }
      if (server.transport !== 'http') continue;
      const unknown = urlPlaceholders(server.url).filter((name) => !(name in defaults));
      if (unknown.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['mcpServers'],
          message: `server "${server.name}" url uses ${unknown.join(', ')}, which settings does not declare`,
        });
      } else if (!isAllowedServerUrl(fillUrlTemplate(server.url, defaults))) {
        ctx.addIssue({
          code: 'custom',
          path: ['mcpServers'],
          message: `server "${server.name}" url must be https (or http on localhost)`,
        });
      }
    }
  });

export type PackManifest = z.infer<typeof packSchema>;

export { secretRefs as packServerSecretRefs };

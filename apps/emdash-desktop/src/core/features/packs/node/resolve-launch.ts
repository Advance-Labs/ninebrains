import type { McpServerEntry, PackLaunch, PackLaunchRole, PackLaunchWarning } from '../api/launch';
import type { PackMcpServer, PackRole, PackValue } from '../api/pack-schema';
import type { LoadedPack } from './loader';
import type { SecretResolver } from './secrets';

export interface ResolvePackLaunchInput {
  /** Loaded packs in load order. */
  packs: readonly LoadedPack[];
  /** Pack ids enabled for the project. */
  enabledPackIds: readonly string[];
  /** `role` (unique across enabled packs) or `pack:role`. */
  roleId?: string;
  secrets: SecretResolver;
}

type Resolved = { ok: true; value: string | undefined } | { ok: false; missing: string };

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function findRole(
  packs: readonly LoadedPack[],
  roleId: string,
  warnings: PackLaunchWarning[]
): { pack: LoadedPack; role: PackRole } | undefined {
  const [packPart, rolePart] = roleId.includes(':') ? roleId.split(':', 2) : [undefined, roleId];
  const matches = packs.flatMap((pack) =>
    (packPart === undefined || pack.manifest.id === packPart
      ? pack.manifest.roles.filter((role) => role.id === rolePart)
      : []
    ).map((role) => ({ pack, role }))
  );
  if (matches.length === 1) return matches[0];
  const packId = packPart ?? matches[0]?.pack.manifest.id ?? '';
  warnings.push({
    packId,
    missingSecrets: [],
    message:
      matches.length === 0
        ? `role "${roleId}" is not in any pack enabled for this project`
        : `role "${roleId}" is ambiguous (${matches.map((m) => m.pack.manifest.id).join(', ')}); use pack:role`,
  });
  return undefined;
}

/**
 * Merges a project's enabled packs into one lane launch. Secrets resolve by
 * name; a server whose required secret is missing is left out with a warning,
 * so a lane never starts with a half-configured server.
 */
export async function resolvePackLaunch(input: ResolvePackLaunchInput): Promise<PackLaunch> {
  const enabled = new Set(input.enabledPackIds);
  const packs = input.packs.filter((pack) => enabled.has(pack.manifest.id));
  const warnings: PackLaunchWarning[] = [];
  const cache = new Map<string, Promise<string | undefined>>();

  const lookup = (name: string) => {
    let pending = cache.get(name);
    if (!pending) {
      pending = input.secrets.resolve(name).catch(() => undefined);
      cache.set(name, pending);
    }
    return pending;
  };

  const resolveValue = async (value: PackValue): Promise<Resolved> => {
    if (typeof value === 'string') return { ok: true, value };
    const secret = await lookup(value.secret);
    if (secret !== undefined) return { ok: true, value: `${value.prefix ?? ''}${secret}` };
    return value.optional ? { ok: true, value: undefined } : { ok: false, missing: value.secret };
  };

  const resolveRecord = async (record: Record<string, PackValue>, missing: string[]) => {
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(record)) {
      const resolved = await resolveValue(raw);
      if (!resolved.ok) missing.push(resolved.missing);
      else if (resolved.value !== undefined) out[key] = resolved.value;
    }
    return out;
  };

  const toEntry = async (server: PackMcpServer, missing: string[]): Promise<McpServerEntry> => {
    if (server.transport === 'http') {
      return {
        name: server.name,
        type: 'http',
        url: server.url,
        headers: await resolveRecord(server.headers, missing),
      };
    }
    const args: string[] = [];
    for (const raw of server.args) {
      const resolved = await resolveValue(raw);
      if (!resolved.ok) missing.push(resolved.missing);
      else if (resolved.value !== undefined) args.push(resolved.value);
    }
    return {
      name: server.name,
      type: 'stdio',
      command: server.command,
      args,
      env: await resolveRecord(server.env, missing),
    };
  };

  const mcpServers: McpServerEntry[] = [];
  const owners = new Map<string, { packId: string; json: string }>();
  for (const pack of packs) {
    for (const server of pack.manifest.mcpServers) {
      const missing: string[] = [];
      const entry = await toEntry(server, missing);
      const packId = pack.manifest.id;
      if (missing.length > 0) {
        warnings.push({
          packId,
          server: server.name,
          missingSecrets: uniq(missing),
          message: `${server.optional ? 'optional ' : ''}server "${server.name}" was left out: missing ${uniq(missing).join(', ')}`,
        });
        continue;
      }
      const json = JSON.stringify(entry);
      const owner = owners.get(server.name);
      if (owner) {
        if (owner.json !== json) {
          warnings.push({
            packId,
            server: server.name,
            missingSecrets: [],
            message: `server "${server.name}" is also defined by pack "${owner.packId}"; that definition wins`,
          });
        }
        continue;
      }
      owners.set(server.name, { packId, json });
      mcpServers.push(entry);
    }
  }

  const found = input.roleId ? findRole(packs, input.roleId, warnings) : undefined;
  const launch: PackLaunch = {
    mcpServers,
    defaultGates: found
      ? uniq(found.role.gates.length > 0 ? found.role.gates : found.pack.manifest.gates)
      : uniq(packs.flatMap((pack) => pack.manifest.gates)),
    warnings,
  };
  if (found) {
    launch.appendSystemPrompt = found.role.systemPrompt;
    const role: PackLaunchRole = {
      packId: found.pack.manifest.id,
      roleId: found.role.id,
      kind: found.role.kind,
    };
    if (found.role.provider) role.provider = found.role.provider;
    if (found.role.model) role.model = found.role.model;
    launch.role = role;
  }
  return launch;
}

import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PackLoadError } from '../api/contract';
import { packSchema, type PackManifest } from '../api/pack-schema';
import type { BundledPack } from './bundled';

export const MAX_PACK_JSON_BYTES = 256 * 1024;
export const MAX_SKILL_BYTES = 256 * 1024;

export interface LoadedPack {
  manifest: PackManifest;
  source: 'bundled' | 'user';
  location: string;
  /** SKILL.md content keyed by skill id. */
  skills: Record<string, string>;
}

export interface PackLoadResult {
  packs: LoadedPack[];
  errors: PackLoadError[];
}

/** Filesystem access for user packs. Every read is confined to one pack directory. */
export interface PackFs {
  /** Names of the sub-directories of `dir`, or [] when it doesn't exist. */
  listDirs(dir: string): Promise<string[]>;
  /** Reads `relativePath` inside `root`, refusing anything that resolves outside it. */
  readInside(root: string, relativePath: string, maxBytes: number): Promise<string>;
}

export const nodePackFs: PackFs = {
  async listDirs(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  },
  async readInside(root, relativePath, maxBytes) {
    const realRoot = await realpath(root);
    const target = await realpath(path.resolve(realRoot, relativePath));
    if (target !== realRoot && !target.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`${relativePath} resolves outside the pack directory`);
    }
    const info = await lstat(target);
    if (!info.isFile()) throw new Error(`${relativePath} is not a file`);
    if (info.size > maxBytes) throw new Error(`${relativePath} is larger than ${maxBytes} bytes`);
    return readFile(target, 'utf8');
  },
};

export interface LoadPacksOptions {
  bundled: readonly BundledPack[];
  /** `<userData>/ninebrains/packs`. Omit to load bundled packs only. */
  userPacksDir?: string;
  fs?: PackFs;
  knownGateIds: ReadonlySet<string>;
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const shown = error.issues.slice(0, 5).map((issue) => {
    const where = issue.path.map(String).join('.') || '(root)';
    return `${where}: ${issue.message}`;
  });
  const more = error.issues.length > 5 ? ` (+${error.issues.length - 5} more)` : '';
  return shown.join('; ') + more;
}

function checkGates(manifest: PackManifest, known: ReadonlySet<string>): string | null {
  const used = [...manifest.gates, ...manifest.roles.flatMap((role) => role.gates)];
  const unknown = [...new Set(used.filter((id) => !known.has(id)))];
  return unknown.length ? `unknown gate id(s): ${unknown.join(', ')}` : null;
}

function peekId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const id = (json as { id?: unknown }).id;
  return typeof id === 'string' && id.length <= 64 ? id : null;
}

function hasFrontmatter(content: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(content);
}

async function validate(
  json: unknown,
  source: LoadedPack['source'],
  location: string,
  readSkill: (relativePath: string) => Promise<string>,
  knownGateIds: ReadonlySet<string>
): Promise<LoadedPack> {
  const parsed = packSchema.safeParse(json);
  if (!parsed.success) throw new Error(describeIssues(parsed.error));
  const manifest = parsed.data;
  const gateProblem = checkGates(manifest, knownGateIds);
  if (gateProblem) throw new Error(gateProblem);

  const skills: Record<string, string> = {};
  for (const skill of manifest.skills) {
    const content = await readSkill(skill.path);
    if (!hasFrontmatter(content)) throw new Error(`${skill.path} has no frontmatter`);
    skills[skill.id] = content;
  }
  return { manifest, source, location, skills };
}

/**
 * Loads bundled packs, then user packs. Each pack is validated on its own:
 * a bad pack becomes an entry in `errors` and never stops the others.
 */
export async function loadPacks(options: LoadPacksOptions): Promise<PackLoadResult> {
  const packs: LoadedPack[] = [];
  const errors: PackLoadError[] = [];
  const ids = new Set<string>();

  for (const bundle of options.bundled) {
    const location = `bundled:${bundle.id}`;
    try {
      const pack = await validate(
        bundle.json,
        'bundled',
        location,
        async (p) => {
          const content = bundle.files[p];
          if (content === undefined) throw new Error(`${p} is not bundled`);
          return content;
        },
        options.knownGateIds
      );
      if (pack.manifest.id !== bundle.id) throw new Error(`id must be "${bundle.id}"`);
      packs.push(pack);
      ids.add(pack.manifest.id);
    } catch (error) {
      errors.push({ source: 'bundled', packId: bundle.id, location, message: String(error) });
    }
  }

  const dir = options.userPacksDir;
  if (!dir) return { packs, errors };
  const fs = options.fs ?? nodePackFs;

  let names: string[];
  try {
    names = (await fs.listDirs(dir)).sort();
  } catch (error) {
    errors.push({ source: 'user', packId: null, location: dir, message: String(error) });
    return { packs, errors };
  }

  for (const name of names) {
    const root = path.join(dir, name);
    let json: unknown;
    try {
      json = JSON.parse(await fs.readInside(root, 'pack.json', MAX_PACK_JSON_BYTES));
      if (ids.has(name)) throw new Error(`a pack with id "${name}" is already loaded`);
      const pack = await validate(
        json,
        'user',
        root,
        (p) => fs.readInside(root, p, MAX_SKILL_BYTES),
        options.knownGateIds
      );
      if (pack.manifest.id !== name) {
        throw new Error(`pack id "${pack.manifest.id}" must match its directory name "${name}"`);
      }
      packs.push(pack);
      ids.add(name);
    } catch (error) {
      errors.push({
        source: 'user',
        packId: peekId(json) ?? name,
        location: root,
        message: String(error),
      });
    }
  }
  return { packs, errors };
}

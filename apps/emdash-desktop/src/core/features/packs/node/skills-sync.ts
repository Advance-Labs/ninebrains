import { isValidSkillName } from '@emdash/core/primitives/skills/api';
import type { LoadedPack } from './loader';

/** The `nb-` skill namespace belongs to Ninebrains packs. Sync removes stale entries in it. */
export const PACK_SKILL_PREFIX = 'nb-';

/** Port over the upstream skills manager (`~/.agentskills/<name>/SKILL.md`). */
export interface SkillsPort {
  listInstalled(): Promise<{ id: string; skillMdContent?: string }[]>;
  install(skill: { id: string; content: string }): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SkillSyncReport {
  installed: string[];
  removed: string[];
  unchanged: string[];
  errors: string[];
}

export function packSkillInstallId(packId: string, skillId: string): string {
  const id = `${PACK_SKILL_PREFIX}${packId}-${skillId}`;
  if (!isValidSkillName(id)) throw new Error(`"${id}" is not a valid skill name`);
  return id;
}

/**
 * Agent Skills expect the frontmatter `name` to match the install directory,
 * so the prefixed install id replaces the upstream name. Nothing else changes.
 */
export function withSkillName(content: string, name: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) throw new Error('SKILL.md has no frontmatter');
  const front = match[1];
  const renamed = /^name:.*$/m.test(front)
    ? front.replace(/^name:.*$/m, `name: ${name}`)
    : `name: ${name}\n${front}`;
  return content.replace(front, renamed);
}

/** Desired install set: every skill of every pack enabled in at least one project. */
export function desiredPackSkills(
  packs: readonly LoadedPack[],
  enabledAnywhere: ReadonlySet<string>
): Map<string, string> {
  const desired = new Map<string, string>();
  for (const pack of packs) {
    if (!enabledAnywhere.has(pack.manifest.id)) continue;
    for (const skill of pack.manifest.skills) {
      const id = packSkillInstallId(pack.manifest.id, skill.id);
      desired.set(id, withSkillName(pack.skills[skill.id] ?? '', id));
    }
  }
  return desired;
}

/**
 * Brings installed `nb-*` skills in line with the desired set. Idempotent:
 * a skill whose content already matches is left alone, and a second run with
 * the same inputs changes nothing.
 */
export async function syncPackSkills(
  port: SkillsPort,
  desired: ReadonlyMap<string, string>
): Promise<SkillSyncReport> {
  const report: SkillSyncReport = { installed: [], removed: [], unchanged: [], errors: [] };
  const installed = new Map(
    (await port.listInstalled())
      .filter((skill) => skill.id.startsWith(PACK_SKILL_PREFIX))
      .map((skill) => [skill.id, skill.skillMdContent])
  );

  for (const [id, content] of desired) {
    if (installed.get(id) === content) {
      report.unchanged.push(id);
      continue;
    }
    try {
      await port.install({ id, content });
      report.installed.push(id);
    } catch (error) {
      report.errors.push(`install ${id}: ${String(error)}`);
    }
  }

  for (const id of installed.keys()) {
    if (desired.has(id)) continue;
    try {
      await port.remove(id);
      report.removed.push(id);
    } catch (error) {
      report.errors.push(`remove ${id}: ${String(error)}`);
    }
  }
  return report;
}

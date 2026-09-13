import { z } from 'zod';

/**
 * Lever A: which Claude model a lane's subagents use, written as `CLAUDE_CODE_SUBAGENT_MODEL`.
 * `inherit` (the default) emits nothing, so each subagent keeps its own frontmatter model.
 */
export const SUBAGENT_TIERS = ['inherit', 'haiku', 'sonnet', 'opus', 'fable'] as const;
export type SubagentTier = (typeof SUBAGENT_TIERS)[number];

/** A full model id: letters, digits and `._:/@-`, plus Claude's optional `[1m]` suffix. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}(\[1m\])?$/;

export const modelIdSchema = z
  .string()
  .trim()
  .regex(MODEL_ID, 'must be a model id such as claude-sonnet-5, with no spaces');

/** A tier alias or a full model id. Validated at every boundary it crosses. */
export const subagentModelSchema = z.union([z.enum(SUBAGENT_TIERS), modelIdSchema]);
export type SubagentModel = z.infer<typeof subagentModelSchema>;

/**
 * The lane's choice wins over its role's; `inherit` at either level means "emit nothing".
 * Returns the value for `CLAUDE_CODE_SUBAGENT_MODEL`, or undefined.
 */
export function resolveSubagentModel(
  lane: string | undefined,
  role: string | undefined
): string | undefined {
  const chosen = lane ?? role;
  if (!chosen || chosen === 'inherit') return undefined;
  return subagentModelSchema.parse(chosen);
}

const TIER_LABELS: Record<SubagentTier, string> = {
  inherit: 'Inherit',
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
};

export function subagentModelLabel(value: string | undefined): string {
  if (!value) return TIER_LABELS.inherit;
  return (TIER_LABELS as Record<string, string>)[value] ?? value;
}

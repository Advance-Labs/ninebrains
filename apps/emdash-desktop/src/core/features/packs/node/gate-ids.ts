import { GATE_IDS } from '@emdash/gates-core';

/** The SEO pack's own gate, implemented in `gates/seo-evidence-gate.ts`. */
export const SEO_EVIDENCE_GATE_ID = 'seo-evidence';

/** Every gate id a pack may reference: gates-core's built-ins plus the pack-slice gates. */
export const KNOWN_GATE_IDS: ReadonlySet<string> = new Set<string>([
  ...Object.values(GATE_IDS),
  SEO_EVIDENCE_GATE_ID,
]);

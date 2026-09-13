/**
 * The rigor table for the settings page. gates-core is node-only (it writes
 * evidence with `node:fs`), so the renderer can't import `RIGOR_THRESHOLDS`;
 * `rigor-table.test.ts` keeps this copy equal to gates-core's `rigorToGates`.
 */
export interface RigorTableRow {
  gate: 'tests' | 'fact-check' | 'screenshot' | 'security-review' | 'reviewer';
  label: string;
  slider: 'testing' | 'security';
  threshold: number;
  kinds: string;
}

export const RIGOR_TABLE: readonly RigorTableRow[] = [
  { gate: 'tests', label: 'Tests', slider: 'testing', threshold: 3, kinds: 'Code, UI' },
  {
    gate: 'fact-check',
    label: 'Fact check',
    slider: 'testing',
    threshold: 3,
    kinds: 'Research, SEO',
  },
  { gate: 'screenshot', label: 'Screenshots', slider: 'testing', threshold: 5, kinds: 'UI' },
  {
    gate: 'security-review',
    label: 'Security review',
    slider: 'security',
    threshold: 6,
    kinds: 'Code, UI',
  },
  { gate: 'reviewer', label: 'Reviewer agent', slider: 'testing', threshold: 7, kinds: 'All' },
];

/** Gate ids attached at these levels, for any job kind. */
export function gatesAttachedAt(testing: number, security: number): Set<RigorTableRow['gate']> {
  return new Set(
    RIGOR_TABLE.filter(
      (row) => (row.slider === 'testing' ? testing : security) >= row.threshold
    ).map((row) => row.gate)
  );
}

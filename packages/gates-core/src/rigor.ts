/**
 * Rigor sliders → default gates. The table is documented in the README; keep
 * the two in step.
 */

import type { JobKind } from './types';

export const GATE_IDS = {
  tests: 'tests',
  screenshot: 'screenshot',
  reviewer: 'reviewer',
  securityReview: 'security-review',
  factCheck: 'fact-check',
} as const;

export type GateId = (typeof GATE_IDS)[keyof typeof GATE_IDS];

export interface Rigor {
  /** 0..10 */
  testing: number;
  /** 0..10 */
  security: number;
}

export const RIGOR_THRESHOLDS = {
  tests: 3,
  factCheck: 3,
  screenshot: 5,
  securityReview: 6,
  reviewer: 7,
} as const;

const CODE_KINDS: ReadonlySet<JobKind> = new Set(['code', 'ui']);
const CLAIM_KINDS: ReadonlySet<JobKind> = new Set(['research', 'seo']);
const KINDS: ReadonlySet<string> = new Set(['code', 'ui', 'research', 'seo', 'docs']);

function assertLevel(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new RangeError(`${name} rigor must be an integer 0..10, got ${value}`);
  }
}

export function rigorToGates(rigor: Rigor, jobKind: JobKind): GateId[] {
  assertLevel('testing', rigor.testing);
  assertLevel('security', rigor.security);
  if (!KINDS.has(jobKind)) throw new RangeError(`unknown job kind: ${jobKind}`);

  const gates: GateId[] = [];
  if (rigor.testing >= RIGOR_THRESHOLDS.tests && CODE_KINDS.has(jobKind)) {
    gates.push(GATE_IDS.tests);
  }
  if (rigor.testing >= RIGOR_THRESHOLDS.factCheck && CLAIM_KINDS.has(jobKind)) {
    gates.push(GATE_IDS.factCheck);
  }
  if (rigor.testing >= RIGOR_THRESHOLDS.screenshot && jobKind === 'ui') {
    gates.push(GATE_IDS.screenshot);
  }
  if (rigor.testing >= RIGOR_THRESHOLDS.reviewer) {
    gates.push(GATE_IDS.reviewer);
  }
  if (rigor.security >= RIGOR_THRESHOLDS.securityReview && CODE_KINDS.has(jobKind)) {
    gates.push(GATE_IDS.securityReview);
  }
  return gates;
}

/**
 * Retrieval quality and validator pass rate, reported side by side.
 *
 * Generalised from Advance Labs' BuildCode citation validator (2026).
 *
 * The validator proves a cited source was RETRIEVED. It cannot prove the
 * retrieved source was the RIGHT one. So an evaluation carries two numbers that
 * must never be collapsed into one score:
 *
 *   validator pass rate — did the model invent anything?
 *   retrieval precision — did we hand it the right material?
 *
 * A green validator next to a poor precision score is a truthful description of
 * a system that is verifiable but not yet accurate.
 */

import type { ValidationResult } from './types';

export interface RetrievalRun {
  /** Source ids that should have been retrieved for this query. */
  expected: string[];
  /** Source ids actually retrieved, best first. */
  retrieved: string[];
}

function assertK(k: number): void {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer, got ${k}`);
}

/** Mean over runs of |top-k ∩ expected| / k. 0 for no runs. */
export function precisionAtK(runs: RetrievalRun[], k: number): number {
  assertK(k);
  if (runs.length === 0) return 0;
  const total = runs.reduce((sum, run) => {
    const expected = new Set(run.expected);
    const hits = run.retrieved.slice(0, k).filter((id) => expected.has(id)).length;
    return sum + hits / k;
  }, 0);
  return total / runs.length;
}

/**
 * Fraction of runs where at least one expected source is in the top k.
 * Recall-shaped: it says whether a correct answer was POSSIBLE, since the
 * answer layer sees all k.
 */
export function hitRateAtK(runs: RetrievalRun[], k: number): number {
  assertK(k);
  if (runs.length === 0) return 0;
  const hits = runs.filter((run) => {
    const expected = new Set(run.expected);
    return run.retrieved.slice(0, k).some((id) => expected.has(id));
  }).length;
  return hits / runs.length;
}

/** Fraction of validation results with no invented or uncited claims. 1 for no results. */
export function validatorPassRate(results: ValidationResult[]): number {
  if (results.length === 0) return 1;
  return results.filter((result) => result.summary.pass).length / results.length;
}

export interface QualityReport {
  k: number;
  precisionAtK: number;
  hitRateAtK: number;
  validatorPassRate: number;
}

/** The two-number report. Deliberately has no combined score. */
export function qualityReport(
  runs: RetrievalRun[],
  results: ValidationResult[],
  k: number
): QualityReport {
  return {
    k,
    precisionAtK: precisionAtK(runs, k),
    hitRateAtK: hitRateAtK(runs, k),
    validatorPassRate: validatorPassRate(results),
  };
}

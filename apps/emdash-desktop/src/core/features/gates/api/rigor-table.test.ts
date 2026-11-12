import { RIGOR_THRESHOLDS, rigorToGates } from '@emdash/gates-core';
import { describe, expect, it } from 'vitest';
import { RIGOR_TABLE, gatesAttachedAt } from './rigor-table';

describe('rigor table (renderer copy)', () => {
  it('matches gates-core thresholds and rigorToGates at every level', () => {
    const byGate = Object.fromEntries(RIGOR_TABLE.map((row) => [row.gate, row.threshold]));
    expect(byGate).toEqual({
      tests: RIGOR_THRESHOLDS.tests,
      'fact-check': RIGOR_THRESHOLDS.factCheck,
      screenshot: RIGOR_THRESHOLDS.screenshot,
      'security-review': RIGOR_THRESHOLDS.securityReview,
      reviewer: RIGOR_THRESHOLDS.reviewer,
    });
    for (let testing = 0; testing <= 10; testing += 1) {
      for (let security = 0; security <= 10; security += 1) {
        const expected = new Set(
          (['code', 'ui', 'research', 'seo', 'docs'] as const).flatMap((kind) =>
            rigorToGates({ testing, security }, kind)
          )
        );
        expect(gatesAttachedAt(testing, security)).toEqual(expected);
      }
    }
  });
});

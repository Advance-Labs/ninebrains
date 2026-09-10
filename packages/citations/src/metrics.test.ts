/**
 * Retrieval precision and validator pass rate are separate numbers.
 *
 * The case that matters: retrieval hands the model the wrong document, the
 * model cites it faithfully, and the validator is green. Only precision@k sees
 * the failure. A report that merged the two would hide it.
 */

import { describe, expect, it } from 'vitest';
import { hitRateAtK, precisionAtK, qualityReport, validatorPassRate } from './metrics';
import { validateClaims } from './validate';

describe('retrieval metrics', () => {
  const runs = [
    { expected: ['a'], retrieved: ['a', 'x', 'y'] },
    { expected: ['b'], retrieved: ['x', 'y', 'b'] },
    { expected: ['c'], retrieved: ['x', 'y', 'z'] },
  ];

  it('computes precision@k as the mean share of relevant results in the top k', () => {
    expect(precisionAtK(runs, 2)).toBeCloseTo(1 / 6);
    expect(precisionAtK(runs, 3)).toBeCloseTo(2 / 9);
  });

  it('computes hit rate@k as the share of runs with any relevant result in the top k', () => {
    expect(hitRateAtK(runs, 1)).toBeCloseTo(1 / 3);
    expect(hitRateAtK(runs, 3)).toBeCloseTo(2 / 3);
  });

  it('rejects a non-positive k and handles no runs', () => {
    expect(() => precisionAtK(runs, 0)).toThrow(RangeError);
    expect(hitRateAtK([], 3)).toBe(0);
  });
});

describe('the two numbers stay separate', () => {
  it('reports a green validator next to a failing retrieval', () => {
    // The question was about ferries; retrieval returned the bus timetable.
    const wrongDoc = { id: 'bus-timetable', text: 'The 14 bus leaves every 20 minutes.' };
    const validation = validateClaims(
      [
        {
          text: 'It leaves every 20 minutes.',
          citations: [{ sourceId: 'bus-timetable', quote: 'leaves every 20 minutes' }],
        },
      ],
      [wrongDoc]
    );
    const report = qualityReport(
      [{ expected: ['ferry-timetable'], retrieved: ['bus-timetable'] }],
      [validation],
      1
    );
    expect(report).toEqual({ k: 1, precisionAtK: 0, hitRateAtK: 0, validatorPassRate: 1 });
  });

  it('computes validator pass rate over results', () => {
    const pass = validateClaims([], []);
    const fail = validateClaims([{ text: 'x', citations: [] }], []);
    expect(validatorPassRate([pass, fail])).toBe(0.5);
    expect(validatorPassRate([])).toBe(1);
  });
});

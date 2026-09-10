import { describe, expect, it } from 'vitest';
import { rigorToGates } from './rigor';
import { SelfHealLoop, decideSelfHeal } from './self-heal';
import type { JobKind } from './types';

describe('decideSelfHeal', () => {
  const fail = { pass: false, feedback: 'tests failed' };
  const pass = { pass: true, feedback: '' };

  it.each([
    [pass, 1, 'pass'],
    [pass, 3, 'pass'],
    [fail, 1, 'retry'],
    [fail, 2, 'retry'],
    [fail, 3, 'block'],
    [fail, 4, 'block'],
  ] as const)('verdict pass=%j at attempt %i → %s', (verdict, attempt, action) => {
    expect(decideSelfHeal(verdict, attempt).action).toBe(action);
  });

  it('carries the feedback forward on retry and into the block reason', () => {
    expect(decideSelfHeal(fail, 1)).toEqual({
      action: 'retry',
      nextAttempt: 2,
      feedback: 'Attempt 1 of 3 failed verification.\n\ntests failed',
    });
    const block = decideSelfHeal(fail, 3);
    expect(block.action === 'block' && block.reason).toMatch(/after 3 failed.*\n\ntests failed/s);
  });

  it('honours a custom cap and rejects invalid input', () => {
    expect(decideSelfHeal(fail, 1, 1).action).toBe('block');
    expect(() => decideSelfHeal(fail, 0)).toThrow(RangeError);
    expect(() => decideSelfHeal(fail, 1.5)).toThrow(RangeError);
    expect(() => decideSelfHeal(fail, 1, 0)).toThrow(RangeError);
  });

  it('is exposed as SelfHealLoop with a cap of 3', () => {
    expect(SelfHealLoop.maxAttempts).toBe(3);
    expect(SelfHealLoop.decide(fail, 2).action).toBe('retry');
  });
});

describe('rigorToGates', () => {
  it.each<[number, number, JobKind, string[]]>([
    [0, 0, 'ui', []],
    [2, 5, 'code', []],
    [3, 0, 'code', ['tests']],
    [3, 0, 'ui', ['tests']],
    [4, 0, 'ui', ['tests']],
    [5, 0, 'ui', ['tests', 'screenshot']],
    [5, 0, 'code', ['tests']],
    [7, 0, 'code', ['tests', 'reviewer']],
    [7, 0, 'ui', ['tests', 'screenshot', 'reviewer']],
    [10, 10, 'ui', ['tests', 'screenshot', 'reviewer', 'security-review']],
    [0, 6, 'code', ['security-review']],
    [0, 5, 'code', []],
    [3, 0, 'research', ['fact-check']],
    [3, 0, 'seo', ['fact-check']],
    [7, 9, 'research', ['fact-check', 'reviewer']],
    [5, 9, 'docs', []],
    [7, 9, 'docs', ['reviewer']],
  ])('testing=%i security=%i kind=%s → %j', (testing, security, kind, expected) => {
    expect(rigorToGates({ testing, security }, kind)).toEqual(expected);
  });

  it('rejects out-of-range levels and unknown kinds', () => {
    expect(() => rigorToGates({ testing: 11, security: 0 }, 'code')).toThrow(RangeError);
    expect(() => rigorToGates({ testing: -1, security: 0 }, 'code')).toThrow(RangeError);
    expect(() => rigorToGates({ testing: 3.5, security: 0 }, 'code')).toThrow(RangeError);
    expect(() => rigorToGates({ testing: 3, security: Number.NaN }, 'code')).toThrow(RangeError);
    expect(() => rigorToGates({ testing: 3, security: 0 }, 'video' as JobKind)).toThrow(RangeError);
  });
});

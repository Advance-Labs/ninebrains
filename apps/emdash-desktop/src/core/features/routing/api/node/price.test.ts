import { describe, expect, it } from 'vitest';
import { emptyUsage, type TokenUsage } from '@core/features/exec-runs/api/node/types';
import type { ProfilePrice } from '../profile';
import { checkBudget, refusesUnpriced, usd, type SpendCap } from './price';

const UNPRICED: ProfilePrice = {
  inPerMTok: null,
  outPerMTok: null,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
};

const PRICE: ProfilePrice = {
  inPerMTok: 3,
  outPerMTok: 15,
  cacheReadPerMTok: 0.3,
  cacheWritePerMTok: 3.75,
};

const usage = (overrides: Partial<TokenUsage>): TokenUsage => ({ ...emptyUsage(), ...overrides });

describe('SEC-43 usd()', () => {
  it('is unpriced when the profile has no in/out price', () => {
    const cost = usd(usage({ inputTokens: 1_000_000 }), UNPRICED);
    expect(cost).toEqual({ priced: false, reason: 'this model profile has no price set' });
  });

  it('multiplies each usage leg by its own per-million-token rate', () => {
    const cost = usd(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
      }),
      PRICE
    );
    expect(cost).toEqual({ priced: true, usd: 3 + 15 + 0.3 + 3.75 });
  });

  it('is zero for a priced profile with no usage, not "unpriced"', () => {
    expect(usd(emptyUsage(), PRICE)).toEqual({ priced: true, usd: 0 });
  });

  it('is unpriced when only the input price is set (isPriced needs both)', () => {
    const halfPriced: ProfilePrice = { ...UNPRICED, inPerMTok: 3 };
    expect(usd(usage({ inputTokens: 1_000_000 }), halfPriced).priced).toBe(false);
  });
});

describe('SEC-43 refusesUnpriced', () => {
  it('refuses an unpriced profile', () => {
    expect(refusesUnpriced(UNPRICED)).toMatch(/no price set/);
  });

  it('allows a priced profile', () => {
    expect(refusesUnpriced(PRICE)).toBeNull();
  });
});

describe('SEC-43 checkBudget: refuse, never downgrade', () => {
  const cap: SpendCap = { scope: 'plan', scopeId: 'plan-1', period: 'day', usd: 5 };

  it('allows spend at or under the cap', () => {
    expect(checkBudget(4, 1, cap)).toEqual({ ok: true });
  });

  it('refuses spend that would cross the cap', () => {
    const result = checkBudget(4, 1.01, cap);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      reason: expect.stringContaining('would spend $5.0100 against its $5.00 day cap'),
    });
  });

  it('refuses a single run already bigger than its own cap', () => {
    const runCap: SpendCap = { scope: 'profile', scopeId: 'p1', period: 'run', usd: 0.5 };
    expect(checkBudget(0, 0.51, runCap).ok).toBe(false);
  });
});

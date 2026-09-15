/**
 * USD cost of a run (plan §4.2, R5, SEC-43): our own multiplication of the CLI's own stream
 * `usage` numbers by the profile's own price, computed here, never taken from the CLI's
 * `--max-budget-usd`. Spike §13 Q3 found that flag prices an unrecognized (non-Claude) model at
 * Opus rates, so it is a coarse backstop only, never the real gate a caller relies on.
 *
 * A cap is checked before a run starts, on the caller's own running total for its scope and
 * period (`run_costs`, R5's persistence, is not built yet): a run or plan projected to go over
 * its cap is refused outright, never moved to a cheaper model (plan §5, SEC-43).
 */
import type { TokenUsage } from '@core/features/exec-runs/api/node/types';
import { isPriced, type ProfilePrice } from '../profile';

export type UsdCost = { priced: true; usd: number } | { priced: false; reason: string };

const perToken = (perMTok: number | null): number => (perMTok ?? 0) / 1_000_000;

/**
 * Input, output and both cache legs, each at the profile's own per-million-token rate. A
 * profile missing its in or out price is unpriced: a caller must refuse to run it unattended
 * rather than show a cost of $0, which would look free when it is really unknown (SEC-43).
 */
export function usd(usage: TokenUsage, price: ProfilePrice): UsdCost {
  if (!isPriced(price)) return { priced: false, reason: 'this model profile has no price set' };
  const total =
    usage.inputTokens * perToken(price.inPerMTok) +
    usage.outputTokens * perToken(price.outPerMTok) +
    usage.cacheReadInputTokens * perToken(price.cacheReadPerMTok) +
    usage.cacheCreationInputTokens * perToken(price.cacheWritePerMTok);
  return { priced: true, usd: total };
}

export type SpendScope = 'profile' | 'plan' | 'global';
export type SpendPeriod = 'run' | 'day';

export interface SpendCap {
  scope: SpendScope;
  scopeId: string;
  period: SpendPeriod;
  usd: number;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

/**
 * SEC-43: a run or plan projected to go over its cap is refused, never moved to a cheaper
 * model. `spentUsd` is the caller's own running total for the cap's scope and period; this
 * function only compares, since `run_costs` persistence (R5) is not built in this wave.
 */
export function checkBudget(spentUsd: number, addingUsd: number, cap: SpendCap): BudgetCheck {
  const projected = spentUsd + addingUsd;
  if (projected <= cap.usd) return { ok: true };
  return {
    ok: false,
    reason: `${cap.scope} "${cap.scopeId}" would spend $${projected.toFixed(4)} against its $${cap.usd.toFixed(2)} ${cap.period} cap`,
  };
}

/** SEC-43: an unpriced profile can't run unattended. Used before a run starts, not per-token. */
export function refusesUnpriced(price: ProfilePrice): string | null {
  return isPriced(price)
    ? null
    : 'this model profile has no price set; add one to run it unattended';
}

/**
 * Self-heal policy: after a verdict, pass, send the task back, or block it.
 *
 * Pure on purpose. The Brain's state machine (`verifying → running` on failure,
 * `blocked` at the cap) applies the decision; this only makes it, so the
 * attempt cap can be tested as a table without a database or a clock.
 */

export const MAX_ATTEMPTS = 3;

export type SelfHealDecision =
  | { action: 'pass' }
  | { action: 'retry'; nextAttempt: number; feedback: string }
  | { action: 'block'; reason: string };

export interface Verdict {
  pass: boolean;
  feedback: string;
}

/**
 * @param attempt the 1-based attempt that was just verified.
 */
export function decideSelfHeal(
  verdict: Verdict,
  attempt: number,
  maxAttempts: number = MAX_ATTEMPTS
): SelfHealDecision {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${attempt}`);
  }
  if (verdict.pass) return { action: 'pass' };
  if (attempt < maxAttempts) {
    return {
      action: 'retry',
      nextAttempt: attempt + 1,
      feedback: `Attempt ${attempt} of ${maxAttempts} failed verification.\n\n${verdict.feedback}`,
    };
  }
  return {
    action: 'block',
    reason: `Blocked after ${attempt} failed verification attempts. Last feedback:\n\n${verdict.feedback}`,
  };
}

export const SelfHealLoop = {
  maxAttempts: MAX_ATTEMPTS,
  decide: decideSelfHeal,
} as const;

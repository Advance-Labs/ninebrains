import * as React from 'react';
import * as styles from './awaiting-input-icon.css';

/**
 * AwaitingInputIcon — a solid, warning-colored circle that gently breathes.
 *
 * The agent is live but blocked on you (a permission prompt, an idle prompt,
 * an elicitation dialog). This is the one status that means "come back to
 * this task," so unlike `working`/`completed`/`error` it deliberately uses a
 * semantic state color (amber) rather than staying monochrome — the same
 * "color reports state" allowance the brand doc already grants pass/fail and
 * diff colors, not a new brand-color exception.
 */
function AwaitingInputIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="7.5" className={styles.dot} strokeWidth="1" />
    </svg>
  );
}

export { AwaitingInputIcon };

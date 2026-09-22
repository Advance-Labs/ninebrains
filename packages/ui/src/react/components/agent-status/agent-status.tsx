import { Tooltip } from '@react/primitives/tooltip';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { AwaitingInputIcon } from './awaiting-input-icon';
import { WorkingMarkIcon } from './working-mark-icon';
import * as styles from './agent-status.css';

export type AgentStatusKind = 'working' | 'awaiting-input' | 'error' | 'completed' | 'idle';

type ActiveAgentStatusKind = Exclude<AgentStatusKind, 'idle'>;

export interface AgentStatusProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** An `idle` (or `null`) status renders nothing. */
  status: AgentStatusKind | null;
  /**
   * Uniform size shorthand. Sets the shared status bounding box.
   * Numbers are treated as CSS px values.
   */
  size?: string | number;
  /** Wrap the indicator in a tooltip naming the status. */
  tooltip?: boolean;
}

const STATUS_LABELS: Record<ActiveAgentStatusKind, string> = {
  working: 'Agent is working',
  'awaiting-input': 'Agent is awaiting input',
  error: 'Agent error',
  completed: 'Agent completed',
};

function toCssLength(size: string | number) {
  return typeof size === 'number' ? `${size}px` : size;
}

function AgentStatus({
  status,
  size = '1.5rem',
  tooltip = false,
  className,
  style,
  role = 'img',
  'aria-label': ariaLabel,
  ...props
}: AgentStatusProps) {
  if (!status || status === 'idle') return null;

  const indicator = (
    <span
      {...props}
      role={role}
      aria-label={ariaLabel ?? STATUS_LABELS[status]}
      data-status={status}
      className={cx(styles.root, className)}
      style={
        {
          '--agent-status-size': toCssLength(size),
          ...style,
        } as React.CSSProperties
      }
    >
      <AgentStatusGlyph status={status} />
    </span>
  );

  if (!tooltip) return indicator;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={indicator} />
      <Tooltip.Content>{STATUS_LABELS[status]}</Tooltip.Content>
    </Tooltip.Root>
  );
}

function AgentStatusGlyph({ status }: { status: ActiveAgentStatusKind }) {
  switch (status) {
    // Real work in progress (tool runs, multi-step turns). Ninebrains uses its
    // own brand mark here instead of the shared thinking-orbs `working` state:
    // flat, hard-edged squares with no gradient or grain, per docs/brand/README.md.
    case 'working':
      return <WorkingMarkIcon className={styles.icon} />;

    // Agent session is live but blocked on the user (permission prompt, idle
    // prompt, elicitation dialog). Ninebrains uses a warning-colored breathing
    // dot here instead of the shared thinking-orbs `breathing` state, so "come
    // back to this task" reads as a distinct, colored signal rather than
    // blending in with the monochrome working glyph.
    case 'awaiting-input':
      return <AwaitingInputIcon className={styles.icon} />;

    case 'completed':
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" className={styles.successShape} strokeWidth="1" />
        </svg>
      );

    case 'error':
      return (
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="5"
            y="5"
            width="16"
            height="16"
            rx="1.5"
            className={styles.errorShape}
            strokeWidth="1"
          />
          <circle cx="13" cy="13" r="0.9" className={styles.errorMark} stroke="none" />
        </svg>
      );
  }
}

export { AgentStatus };

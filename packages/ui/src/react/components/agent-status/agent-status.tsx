import { THEME_MANIFEST, useThemeOptional } from '@react/primitives/theme-provider';
import { Tooltip } from '@react/primitives/tooltip';
import { cx } from '@styles/utilities/cx';
import * as React from 'react';
import { ThinkingOrb } from 'thinking-orbs';
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

/**
 * Resolves the app's active theme polarity for `<ThinkingOrb theme>`. The
 * orb's own `theme="auto"` detection looks for a `data-theme` attribute or a
 * `dark`/`light` class on an ancestor (the Tailwind/shadcn convention); this
 * app applies theme via `.emlight` / `.emdark` / `.emsolarized-*` selector
 * classes on `<html>` instead, so auto-detection would never match. Pin the
 * orb's theme from the same THEME_MANIFEST polarity the rest of the design
 * system uses.
 */
function useOrbTheme(): 'light' | 'dark' {
  const ctx = useThemeOptional();
  if (!ctx) return 'light';
  const entry = THEME_MANIFEST.find((e) => e.id === ctx.themeId);
  return entry?.polarity ?? 'light';
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
  const orbTheme = useOrbTheme();

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
      <AgentStatusGlyph status={status} theme={orbTheme} />
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

function AgentStatusGlyph({
  status,
  theme,
}: {
  status: ActiveAgentStatusKind;
  theme: 'light' | 'dark';
}) {
  switch (status) {
    // Real work in progress (tool runs, multi-step turns) — thinking-orbs
    // `working` state. The canonical schema (TuiAgentStateStatus) doesn't
    // distinguish tool phases (search/test/generate) on this path, so this
    // stays the generic `working` orb rather than a faked-in phase.
    case 'working':
      return <ThinkingOrb state="working" size={20} theme={theme} aria-hidden="true" />;

    // Agent session is live but blocked on the user (permission prompt,
    // idle prompt, elicitation dialog) — thinking-orbs `breathing` state.
    case 'awaiting-input':
      return <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />;

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

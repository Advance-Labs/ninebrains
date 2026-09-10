import { cn } from '@core/primitives/styling/browser/cn';
import type { LaneStatus } from '../api';

const LABELS: Record<LaneStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Waiting on you',
  verifying: 'Verifying',
  blocked: 'Blocked',
  asleep: 'Asleep',
};

export function laneStatusLabel(status: LaneStatus): string {
  return LABELS[status];
}

/** The lane status light. Same dot vocabulary as the connection status dot. */
export function LaneStatusLight({ status, className }: { status: LaneStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Status: ${LABELS[status]}`}
      title={LABELS[status]}
      data-status={status}
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        {
          'bg-foreground-muted': status === 'idle',
          'animate-pulse bg-foreground-info': status === 'running',
          'bg-foreground-warning': status === 'waiting',
          'bg-foreground-success': status === 'verifying',
          'bg-foreground-error': status === 'blocked',
          'border border-foreground-muted': status === 'asleep',
        },
        className
      )}
    />
  );
}

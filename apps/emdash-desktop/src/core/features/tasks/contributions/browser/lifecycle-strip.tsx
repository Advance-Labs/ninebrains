import { ScriptStatus, type ScriptStatusKind } from '@emdash/ui/react/components';
import { cn } from '@core/primitives/styling/browser/cn';
import type { WorkspaceLifecycleStepInfo } from '@core/primitives/tasks/api';
import { LIFECYCLE_STEP_TITLES } from '@core/primitives/workspaces/api';

const STATUS_ICONS: Record<
  Exclude<WorkspaceLifecycleStepInfo['status'], 'skipped'>,
  ScriptStatusKind
> = {
  pending: 'waiting',
  running: 'in-progress',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'cancelled',
};

/**
 * A row of chips, one per recorded workspace lifecycle step, each carrying the
 * same status icon and title `ActivityBadge` uses. Real state only: a step
 * with no recorded status simply isn't in the list.
 */
export function LifecycleStrip({
  steps,
  glow = false,
}: {
  steps: WorkspaceLifecycleStepInfo[] | null | undefined;
  /** Hardstyle-theme flourish: adds a glow ring around the running step. */
  glow?: boolean;
}) {
  const visible = (steps ?? []).filter(
    (
      step
    ): step is WorkspaceLifecycleStepInfo & {
      status: Exclude<WorkspaceLifecycleStepInfo['status'], 'skipped'>;
    } => step.id !== 'fetch-refs' && step.status !== 'skipped'
  );
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((step) => (
        <div
          key={step.id}
          className={cn(
            'flex items-center gap-1 rounded-md border border-border bg-background-secondary px-1.5 py-1 text-[11px] text-foreground-muted',
            glow && step.status === 'running' && 'shadow-[0_0_10px_var(--em-accent-9)]'
          )}
        >
          <ScriptStatus status={STATUS_ICONS[step.status]} size={12} />
          <span className="truncate">{LIFECYCLE_STEP_TITLES[step.id]}</span>
        </div>
      ))}
    </div>
  );
}

import { observer } from 'mobx-react-lite';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { useTaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import { cn } from '@core/primitives/styling/browser/cn';

/**
 * A small added/removed bar for one task's working diff. Renders nothing when
 * the underlying stats are unavailable or empty — the same `visible` guard
 * `TaskGitDiffStats` (the sidebar badge) already uses, so this never shows a
 * stale or fabricated number.
 */
export const GitDiffPulse = observer(function GitDiffPulse({
  task,
  glow = false,
}: {
  task: TaskStore;
  glow?: boolean;
}) {
  const { linesAdded, linesDeleted, visible } = useTaskGitDiffStats(task);
  if (!visible) return null;

  const total = linesAdded + linesDeleted || 1;
  const addedPct = (linesAdded / total) * 100;

  return (
    <div className="flex items-center gap-2 text-xs tabular-nums">
      <div
        className={cn(
          'flex h-1.5 w-20 overflow-hidden rounded-full bg-background-secondary',
          glow && 'shadow-[0_0_8px_var(--em-accent-9)]'
        )}
      >
        <div className="h-full bg-foreground-success" style={{ width: `${addedPct}%` }} />
        <div className="h-full bg-foreground-destructive" style={{ width: `${100 - addedPct}%` }} />
      </div>
      <span className="text-foreground-success">+{linesAdded}</span>
      <span className="text-foreground-destructive">-{linesDeleted}</span>
    </div>
  );
});

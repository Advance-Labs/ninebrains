import { EmptyState } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { GitDiffPulse } from '@core/features/tasks/contributions/browser/git-diff-pulse';
import { LifecycleStrip } from '@core/features/tasks/contributions/browser/lifecycle-strip';
import { useTheme } from '@core/primitives/theme/browser';

/**
 * Pulse tab: a per-task read-only snapshot of what's real and observable
 * about this task right now — the workspace lifecycle timeline and the
 * working diff. No fabricated numbers: each widget hides itself when its
 * underlying data isn't there yet.
 */
export const PulseTabContent = observer(function PulseTabContent({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const { effectiveTheme } = useTheme();
  const glow = effectiveTheme === 'emhardstyle';

  if (!taskStore) {
    return <EmptyState label="Pulse unavailable" description="This task is no longer available." />;
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
          Workspace lifecycle
        </h3>
        <LifecycleStrip steps={taskStore.workspaceLifecycle} glow={glow} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
          Working diff
        </h3>
        <GitDiffPulse task={taskStore} glow={glow} />
      </section>
    </div>
  );
});

import { EmptyState } from '@emdash/ui/react/components';
import { PageLayout } from '@emdash/ui/react/patterns';
import { observer } from 'mobx-react-lite';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  asAvailableProject,
  getProjectManagerStore,
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import {
  getTaskManagerStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { GitDiffPulse } from '@core/features/tasks/contributions/browser/git-diff-pulse';
import { LifecycleStrip } from '@core/features/tasks/contributions/browser/lifecycle-strip';
import { cn } from '@core/primitives/styling/browser/cn';
import { isProvisioned } from '@core/primitives/task-state/browser/task-state';
import { useTheme } from '@core/primitives/theme/browser';

/**
 * Every provisioned task across every available project, in one place. Same
 * data, same widgets as the per-task Pulse tab — nothing here is aggregated
 * or estimated beyond "list every task and show what's real about it now."
 */
function useArenaTasks(): Array<{ projectId: string; projectName: string; task: TaskStore }> {
  const rows: Array<{ projectId: string; projectName: string; task: TaskStore }> = [];
  for (const [projectId] of getProjectManagerStore().projects) {
    const projectContext = asAvailableProject(getProjectStore(projectId));
    if (!projectContext) continue;
    const projectName = projectDisplayName(getProjectStore(projectId)) ?? 'Untitled project';
    const taskManager = getTaskManagerStore(projectId);
    if (!taskManager) continue;
    for (const task of taskManager.tasks.values()) {
      if (!isProvisioned(task)) continue;
      rows.push({ projectId, projectName, task });
    }
  }
  return rows;
}

const ArenaTaskCard = observer(function ArenaTaskCard({
  projectName,
  task,
  glow,
}: {
  projectName: string;
  task: TaskStore;
  glow: boolean;
}) {
  const status = taskAgentStatus(task);
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background-secondary p-4',
        glow && status === 'working' && 'shadow-[0_0_16px_var(--em-accent-9)]'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {taskDisplayName(task) ?? 'Untitled task'}
          </span>
          <span className="truncate text-xs text-foreground-muted">{projectName}</span>
        </div>
        {status ? (
          <span className="shrink-0 rounded-full bg-background-quaternary-1 px-2 py-0.5 text-[11px] text-foreground-muted">
            {status}
          </span>
        ) : null}
      </div>
      <LifecycleStrip steps={task.workspaceLifecycle} glow={glow} />
      <GitDiffPulse task={task} glow={glow} />
    </div>
  );
});

export const ArenaDashboard = observer(function ArenaDashboard() {
  const rows = useArenaTasks();
  const { effectiveTheme } = useTheme();
  const glow = effectiveTheme === 'emhardstyle';

  return (
    <PageLayout>
      <PageLayout.Content maxWidth="4xl">
        <PageLayout.Header
          title="Activity"
          description={`Every agent running right now: ${rows.length} active task${
            rows.length === 1 ? '' : 's'
          } across every open project.`}
        />
        {rows.length === 0 ? (
          <EmptyState
            label="Nothing running"
            description="Provisioned tasks will show up here with their live lifecycle and diff activity."
          />
        ) : (
          // Track count follows the column's own width, not the viewport's. `sm:grid-cols-2`
          // asked a viewport media query how wide this column is; with the sidebar open, a
          // narrow window or UI zoom the two disagree, and PageLayout's scroller sets
          // `overflow-x: hidden`, so the second column was clipped with no way to scroll to it.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3 py-4">
            {rows.map(({ projectId, projectName, task }) => (
              <ArenaTaskCard
                key={`${projectId}:${task.data.id}`}
                projectName={projectName}
                task={task}
                glow={glow}
              />
            ))}
          </div>
        )}
      </PageLayout.Content>
    </PageLayout>
  );
});

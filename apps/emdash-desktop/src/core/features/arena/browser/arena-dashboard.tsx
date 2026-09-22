import { EmptyState } from '@emdash/ui/react/components';
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { JOB_STATE_META, OPEN_JOB_STATES, type BrainJobView } from '@core/features/brain/api';
import { useBrainAllJobs, useBrainOverview } from '@core/features/brain/contributions/arena';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import { plannerViewDef } from '@core/features/planner/contributions/views';
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
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { isProvisioned } from '@core/primitives/task-state/browser/task-state';
import { useTheme } from '@core/primitives/theme/browser';

/** A project's display name, or null when the project is no longer open (a stale cross-project job). */
function projectNameOf(projectId: string): string | null {
  const context = asAvailableProject(getProjectStore(projectId));
  if (!context) return null;
  return projectDisplayName(getProjectStore(projectId)) ?? 'Untitled project';
}

/** The Brain's view of every project at once: dispatcher state and every open job. Exported for screenshots. */
export const BrainSection = observer(function BrainSection() {
  const { dispatcher } = useBrainOverview();
  const { jobs: allJobs, error } = useBrainAllJobs();
  const { navigate } = useNavigate();
  const blocked = allJobs.filter((job: BrainJobView) => job.state === 'blocked');

  if (error) {
    return (
      <div className="mb-4 rounded-lg border border-border bg-background-secondary p-4 text-xs text-foreground-muted">
        Brain status is unavailable right now — could not load jobs across projects.
      </div>
    );
  }

  if (allJobs.length === 0 && dispatcher.activeRuns === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-background-secondary p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Brain</span>
        <Badge tone={dispatcher.stopLatched ? 'error' : dispatcher.paused ? 'warning' : 'success'}>
          {dispatcher.stopLatched ? 'stopped' : dispatcher.paused ? 'paused' : 'dispatching'}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-1">
          {OPEN_JOB_STATES.map((state) => {
            const count = allJobs.filter((job: BrainJobView) => job.state === state).length;
            return count > 0 ? (
              <Badge key={state} tone={state === 'blocked' ? 'error' : 'neutral'}>
                {count} {JOB_STATE_META[state].label}
              </Badge>
            ) : null;
          })}
        </div>
      </div>
      {blocked.length > 0 && (
        <ul className="flex flex-col gap-1">
          {blocked.map((job: BrainJobView) => {
            const projectName = projectNameOf(job.projectId);
            return (
              <li
                key={job.id}
                className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs"
              >
                <span className="truncate text-foreground-muted">
                  <span className="text-foreground">{job.title}</span> ·{' '}
                  {projectName ?? 'project no longer open'}
                  {job.reason && <span> — {job.reason}</span>}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-xs"
                  disabled={projectName === null}
                  title={projectName === null ? 'This job’s project is no longer open' : undefined}
                  onClick={() => navigate(plannerViewDef({ projectId: job.projectId }))}
                >
                  Open plan
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

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
        'flex flex-col gap-3 rounded-lg border border-border bg-background-secondary p-4',
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
          title="Arena"
          description={`${rows.length} active task${rows.length === 1 ? '' : 's'} across every open project.`}
        />
        <BrainSection />
        {rows.length === 0 ? (
          <EmptyState
            label="Nothing running"
            description="Provisioned tasks will show up here with their live lifecycle and diff activity."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-2">
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

import { EmptyState } from '@emdash/ui/react/components';
import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, type ComponentProps } from 'react';
import { browserSessionStore } from '@core/features/browser/api/browser/browser-session-store';
import { browserTaskTabContributions } from '@core/features/browser/contributions/tabs';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { TaskViewWrapper } from '@core/features/tasks/contributions/browser/task-view-context';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { PaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';
import type { Lane } from '../../api';

const [browserTabProvider] = browserTaskTabContributions;
type BrowserTabHost = ComponentProps<typeof browserTabProvider.TabContent>['host'];

/**
 * The lane's preview browser. Reuses the browser slice's tab content (and so
 * `BrowserPane`) with a single tab carrying the lane's stable `browserId`, so
 * the preview survives toggling. BrowserPane reads the task's preview servers,
 * which exist once the lane task's workspace has loaded in this window.
 */
export const LaneBrowser = observer(function LaneBrowser({ lane }: { lane: Lane }) {
  const { navigate } = useNavigate();
  const composition = getTaskComposition(lane.projectId, lane.taskId);
  const workspaceId = getTaskStore(lane.projectId, lane.taskId)?.workspaceId;

  useEffect(() => {
    if (!workspaceId || browserSessionStore.getSession(lane.browserId)) return;
    browserSessionStore.createSession({
      projectId: lane.projectId,
      workspaceId,
      taskId: lane.taskId,
      browserId: lane.browserId,
    });
  }, [lane.browserId, lane.projectId, lane.taskId, workspaceId]);

  // A one-tab host: BrowserTabContent reads only `resolvedTabs` (kind,
  // isActive, resource.browserId), so the lane never opens a task-pane tab.
  const host = useMemo(
    () =>
      ({
        resolvedTabs: [
          { kind: 'browser', isActive: true, resource: { browserId: lane.browserId } },
        ],
      }) as unknown as BrowserTabHost,
    [lane.browserId]
  );

  if (!composition?.previewServers || !workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          label="Browser not ready"
          description="Open this lane's task once so its workspace loads in this window, then come back."
          action={
            <Button
              onClick={() =>
                navigate(taskViewDef({ projectId: lane.projectId, taskId: lane.taskId }))
              }
            >
              Open task
            </Button>
          }
        />
      </div>
    );
  }

  const TabContent = browserTabProvider.TabContent;
  const pane = composition.paneLayout.focusedPane;
  return (
    <TaskViewWrapper projectId={lane.projectId} taskId={lane.taskId}>
      <PaneContext.Provider
        value={{
          paneId: `lane-${lane.laneId}`,
          pane,
          scopeInstance: undefined,
          isFocusedPane: false,
        }}
      >
        <div className="relative h-full w-full">
          <TabContent host={host} ctx={pane.ctx} />
        </div>
      </PaneContext.Provider>
    </TaskViewWrapper>
  );
});

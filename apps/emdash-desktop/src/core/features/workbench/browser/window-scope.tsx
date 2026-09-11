import { toast } from '@emdash/ui/react/primitives';
import { useLayoutEffect, type ReactNode } from 'react';
import { captureDevPerfTrace } from '@core/features/dev-perf/api/browser/capture-trace';
import { lanesViewDef } from '@core/features/lanes/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { toggleAppTheme } from '@core/features/settings/api/browser/theme-toggle';
import {
  getRegisteredTaskData,
  taskHostActionAvailability,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { applyHistoryEntry } from '@core/features/workbench/browser/nav-buttons';
import { useWorkspaceLayoutContext } from '@core/features/workbench/contributions/browser/layout-provider';
import { openModal } from '@core/manifests/browser/modal-api';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { windowScope } from '@core/manifests/browser/scope-catalog';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { confirmRegistry } from '@core/primitives/keybindings/browser';
import {
  useViewParams,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import {
  getNavigation,
  getNavigationHistory,
} from '@core/primitives/navigation/browser/navigation-selectors';
import { toggleSettingsView } from '@core/primitives/navigation/browser/settings-toggle';
import { openInCommandRegistry } from '@core/primitives/open-in-apps/browser/open-in-command-registry';
import { EMDASH_ISSUES_NEW_URL } from '@core/primitives/urls/api/urls';
import { disabled, enabled, hidden, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';

export function WindowScope({ children }: { readonly children: ReactNode }) {
  const { currentView } = useWorkspaceSlots();
  const taskParams = useViewParams(taskViewDef);
  const projectParams = useViewParams(projectViewDef);
  const { toggleLeftSidebar, toggleZenMode } = useWorkspaceLayoutContext();

  const currentProjectId =
    currentView === 'task'
      ? taskParams?.projectId
      : currentView === 'project'
        ? projectParams?.projectId
        : undefined;
  const currentTaskId = currentView === 'task' ? taskParams?.taskId : undefined;

  const implementation = {
    'app.settings': () => ({
      execute: () => toggleSettingsView(),
    }),
    'app.newProject': () => ({
      execute: () => {
        void openModal('addProjectModal', { strategy: 'local', mode: 'pick' });
      },
    }),
    'app.newTask': () => ({
      availability: () => {
        if (!currentProjectId) return hidden;
        return taskHostActionAvailability(currentProjectId).kind === 'enabled'
          ? enabled
          : disabled(
              projectAvailabilityUi.getLiveActionDisabledReason(currentProjectId) ??
                projectAvailabilityUi.defaultLiveActionDisabledReason
            );
      },
      execute: (input) => {
        const projectId = input?.projectId ?? currentProjectId;
        if (projectId && taskHostActionAvailability(projectId).kind === 'enabled') {
          void openModal('taskModal', { projectId });
        }
      },
    }),
    // Ninebrains: feedback opens a GitHub issue; Emdash's feedback relay is cut.
    'app.giveFeedback': () => ({
      execute: () => {
        void openExternal(EMDASH_ISSUES_NEW_URL);
      },
    }),
    'app.toggleTheme': () => ({
      execute: () => {
        void toggleAppTheme().then((result) => {
          if (result.success) return;
          toast.error('Theme not changed', { description: result.error.message });
        });
      },
    }),
    'app.navigateBack': () => ({
      availability: () =>
        getNavigationHistory().canGoBack ? enabled : disabled('No previous location'),
      execute: () => getNavigationHistory().back(applyHistoryEntry),
    }),
    'app.navigateForward': () => ({
      availability: () =>
        getNavigationHistory().canGoForward ? enabled : disabled('No next location'),
      execute: () => getNavigationHistory().forward(applyHistoryEntry),
    }),
    'app.commandPalette': () => ({
      execute: () => {
        const workspaceId =
          currentProjectId && currentTaskId
            ? (getRegisteredTaskData(currentProjectId, currentTaskId)?.workspaceId ?? undefined)
            : undefined;
        void openModal('commandPaletteModal', {
          projectId: currentProjectId,
          taskId: currentTaskId,
          workspaceId,
        });
      },
    }),
    'app.openInEditor': () => ({
      availability: () => (openInCommandRegistry.get() ? enabled : hidden),
      execute: () => openInCommandRegistry.get()?.trigger(),
    }),
    'app.confirm': () => ({
      availability: () => (confirmRegistry.current?.isEnabled() ? enabled : hidden),
      execute: () => confirmRegistry.current?.trigger(),
    }),
    'workbench.toggleLeftSidebar': () => ({
      execute: () => toggleLeftSidebar(),
    }),
    'devPerf.processPanel': () => ({
      execute: () => {
        void openModal('devProcessPanelModal');
      },
    }),
    'devPerf.captureTrace': () => ({
      execute: () => {
        toast('Recording performance trace', { description: 'Capturing 10 seconds…' });
        void captureDevPerfTrace().then((outcome) =>
          outcome.ok
            ? toast.success('Trace captured', { description: outcome.path })
            : toast.error('Trace capture failed', { description: outcome.message })
        );
      },
    }),
    // Zen is workspace-chrome data; the task sidebar hides while zen is
    // active as a derived condition (no task-chrome mutation).
    'workbench.zenMode': () => ({
      execute: () => toggleZenMode(),
    }),
    'lanes.open': () => ({
      execute: () => getNavigation().navigate(lanesViewDef({})),
    }),
    // Ninebrains: other slices open a job's verification by command id.
    'gates.openJobVerification': () => ({
      execute: (input) => {
        if (input?.jobId) void openModal('jobVerificationModal', { jobId: input.jobId });
      },
    }),
  } satisfies ViewScopeImpl<typeof windowScope>;

  const { instance } = useViewScope(windowScope(), implementation);

  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  if (!instance) return null;
  return <ViewScopeInstanceProvider instance={instance}>{children}</ViewScopeInstanceProvider>;
}

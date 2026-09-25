import { EmptyState } from '@emdash/ui/react/components';
import {
  Button,
  Resizable,
  Spinner,
  useCollapsiblePanelBinding,
} from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useMemo, type ReactNode } from 'react';
import {
  BrainDrawer,
  BrainTitlebarControls,
} from '@core/features/brain/contributions/lanes-drawer';
import { plannerViewDef } from '@core/features/planner/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { createLayoutStorage } from '@core/primitives/mementos/browser/layout-storage';
import { useSubjectSpace } from '@core/primitives/mementos/react';
import { useNavigate, useViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { appSubject } from '@core/primitives/subjects/api';
import { defineViewRuntime } from '@core/primitives/views/react';
import type { Lane, LaneTab } from '../../api';
import { lanesViewDef } from '../../contributions/views';
import { LaneTerminal } from '../lane-terminal';
import { runLaneAction, useLaneBoard } from '../use-lanes';
import { brainDrawer, setDrawerOpen } from './brain-drawer-state';
import { LanesGrid } from './lanes-grid';
import { LanesTabStrip } from './lanes-tab-strip';
import { openProjects } from './project-fallback';

function LanesViewWrapper({ children }: { children: ReactNode; tabId?: string }) {
  return <>{children}</>;
}

const LanesTitlebar = observer(function LanesTitlebar() {
  const { board } = useLaneBoard();
  const { navigate } = useNavigate();
  // The planner opens on the first lane's project across all tabs, else the first project.
  const projectId =
    board.tabs
      .flatMap((candidate) => candidate.slots.filter((lane): lane is Lane => lane !== null))
      .find((lane) => lane)?.projectId ?? getProjectManagerStore().projects.keys().next().value;
  return (
    <Titlebar
      leftSlot={<LanesTabStrip />}
      rightSlot={
        <div className="flex items-center">
          <Button
            size="sm"
            variant="ghost"
            data-testid="lanes-open-planner"
            disabled={!projectId}
            title={projectId ? "Plan this project's jobs on a canvas" : 'Add a project first'}
            onClick={() => projectId && navigate(plannerViewDef({ projectId }))}
          >
            Planner
          </Button>
          <BrainTitlebarControls
            drawerOpen={brainDrawer.open}
            onToggleDrawer={() => setDrawerOpen(!brainDrawer.open)}
          />
        </div>
      }
    />
  );
});

const LanesMainPanel = observer(function LanesMainPanel() {
  const params = useViewParams(lanesViewDef);
  const { board, isLoading } = useLaneBoard();
  const tab = board.tabs.find((candidate) => candidate.tabId === params?.tabId) ?? board.tabs[0];

  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center">
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          <EmptyState
            label="No tabs yet"
            description="A tab holds a 2×2 grid of agent lanes."
            action={
              <Button
                onClick={() =>
                  void runLaneAction('Could not add a tab', (client) => client.createTab({}))
                }
              >
                New tab
              </Button>
            }
          />
        )}
      </div>
    );
  }
  return <LanesWithBrain tab={tab} />;
});

/** The grid plus the collapsible Brain drawer on the right (SEAMS §3.9). */
const LanesWithBrain = observer(function LanesWithBrain({ tab }: { tab: LaneTab }) {
  const appSpace = useSubjectSpace(appSubject);
  const storage = useMemo(
    () => createLayoutStorage(appSpace, workbenchPanelLayoutsMemento),
    [appSpace]
  );
  const binding = useCollapsiblePanelBinding({
    storageKey: 'lanes:brain-drawer',
    storage,
    panelIds: ['lanes-main', 'brain-drawer'],
    collapsiblePanelId: 'brain-drawer',
    open: brainDrawer.open,
    onCloseRequest: () => setDrawerOpen(false),
  });
  const lanes = tab.slots.filter((lane): lane is Lane => lane !== null);
  const laneProjects = [...new Map(lanes.map((lane) => [lane.projectId, lane])).values()].map(
    (lane) => ({ projectId: lane.projectId, name: lane.projectName ?? 'project' })
  );
  // A Brain session needs a project, not a lane. Before the first lane exists `laneProjects` is
  // empty, which left every Brain action in the drawer disabled — the orchestrator stuck behind
  // the lanes it exists to hand work to. Fall back to the open projects, most recently visited
  // first, so "Start Brain" opens on the project the user was last working in. One Brain per
  // project is the model; this only decides which one a fresh Brain starts in.
  const projects = laneProjects.length > 0 ? laneProjects : openProjects();

  return (
    <Resizable.Group
      orientation="horizontal"
      id="lanes:brain-drawer"
      defaultLayout={binding.groupProps.defaultLayout}
      onLayoutChanged={binding.groupProps.onLayoutChanged}
      className="h-full w-full"
    >
      <Resizable.Panel id="lanes-main" minSize="40%">
        <LanesGrid key={tab.tabId} tab={tab} />
      </Resizable.Panel>
      {brainDrawer.open && (
        <>
          <Resizable.Handle />
          <Resizable.Panel minSize="20%" maxSize="50%" {...binding.collapsiblePanelProps}>
            <BrainDrawer
              projects={projects}
              lanes={lanes.map((lane) => ({ laneId: lane.laneId, label: `Lane ${lane.slot + 1}` }))}
              renderTerminal={(session) => (
                <LaneTerminal key={session.conversationId} lane={session} focused={false} />
              )}
            />
          </Resizable.Panel>
        </>
      )}
    </Resizable.Group>
  );
});

export const lanesViewRuntime = defineViewRuntime(lanesViewDef, {
  slots: {
    wrap: LanesViewWrapper,
    titlebar: LanesTitlebar,
    main: LanesMainPanel,
  },
});

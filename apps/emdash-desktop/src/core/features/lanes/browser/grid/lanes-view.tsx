import { EmptyState } from '@emdash/ui/react/components';
import {
  Button,
  Resizable,
  Spinner,
  useCollapsiblePanelBinding,
} from '@emdash/ui/react/primitives';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useMemo, type ReactNode } from 'react';
import {
  BrainDrawer,
  BrainTitlebarControls,
} from '@core/features/brain/contributions/lanes-drawer';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { createLayoutStorage } from '@core/primitives/mementos/browser/layout-storage';
import { useSubjectSpace } from '@core/primitives/mementos/react';
import { useViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { appSubject } from '@core/primitives/subjects/api';
import { defineViewRuntime } from '@core/primitives/views/react';
import type { Lane, LaneTab } from '../../api';
import { lanesViewDef } from '../../contributions/views';
import { LaneTerminal } from '../lane-terminal';
import { runLaneAction, useLaneBoard } from '../use-lanes';
import { LanesGrid } from './lanes-grid';
import { LanesTabStrip } from './lanes-tab-strip';

/** Whether the Brain drawer is open. Shared by the titlebar toggle and the main panel. */
const brainDrawer = observable({ open: false });
const setDrawerOpen = (open: boolean) => runInAction(() => (brainDrawer.open = open));

function LanesViewWrapper({ children }: { children: ReactNode; tabId?: string }) {
  return <>{children}</>;
}

const LanesTitlebar = observer(function LanesTitlebar() {
  return (
    <Titlebar
      leftSlot={<LanesTabStrip />}
      rightSlot={
        <BrainTitlebarControls
          drawerOpen={brainDrawer.open}
          onToggleDrawer={() => setDrawerOpen(!brainDrawer.open)}
        />
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
  const projects = [...new Map(lanes.map((lane) => [lane.projectId, lane])).values()].map(
    (lane) => ({ projectId: lane.projectId, name: lane.projectName ?? 'project' })
  );

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

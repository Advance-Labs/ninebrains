import { EmptyState } from '@emdash/ui/react/components';
import { Button, Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { plannerViewDef } from '@core/features/planner/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { useNavigate, useViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { defineViewRuntime } from '@core/primitives/views/react';
import type { Lane } from '../../api';
import { lanesViewDef } from '../../contributions/views';
import { runLaneAction, useLaneBoard } from '../use-lanes';
import { LanesGrid } from './lanes-grid';
import { LanesTabStrip } from './lanes-tab-strip';

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
  return <LanesGrid key={tab.tabId} tab={tab} />;
});

export const lanesViewRuntime = defineViewRuntime(lanesViewDef, {
  slots: {
    wrap: LanesViewWrapper,
    titlebar: LanesTitlebar,
    main: LanesMainPanel,
  },
});

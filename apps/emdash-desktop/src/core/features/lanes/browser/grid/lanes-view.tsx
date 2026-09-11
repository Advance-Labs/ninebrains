import { EmptyState } from '@emdash/ui/react/components';
import { Button, Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { useViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { defineViewRuntime } from '@core/primitives/views/react';
import { lanesViewDef } from '../../contributions/views';
import { runLaneAction, useLaneBoard } from '../use-lanes';
import { LanesGrid } from './lanes-grid';
import { LanesTabStrip } from './lanes-tab-strip';

function LanesViewWrapper({ children }: { children: ReactNode; tabId?: string }) {
  return <>{children}</>;
}

function LanesTitlebar() {
  return <Titlebar leftSlot={<LanesTabStrip />} />;
}

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

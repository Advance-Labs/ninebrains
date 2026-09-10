import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useNavigate, useViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { aggregateLaneStatus } from '../../api';
import { lanesViewDef } from '../../contributions/views';
import { LaneStatusLight } from '../status-light';
import { runLaneAction, useLaneBoard, useLaneStatuses } from '../use-lanes';

/** One button per tab, each with the most urgent light among its lanes. */
export const LanesTabStrip = observer(function LanesTabStrip() {
  const { board } = useLaneBoard();
  const statuses = useLaneStatuses();
  const params = useViewParams(lanesViewDef);
  const { navigate } = useNavigate();
  const activeTabId =
    board.tabs.find((tab) => tab.tabId === params?.tabId)?.tabId ?? board.tabs[0]?.tabId;

  const addTab = async () => {
    const created = await runLaneAction('Could not add a tab', (client) => client.createTab({}));
    if (created) navigate(lanesViewDef({ tabId: created.tabId }));
  };

  return (
    <div role="tablist" aria-label="Lane tabs" className="flex min-w-0 items-center gap-0.5 pl-2">
      <span className="mr-1 text-sm font-medium text-foreground">Lanes</span>
      {board.tabs.map((tab) => {
        const lanes = tab.slots.flatMap((lane) => (lane ? [lane] : []));
        const aggregate = aggregateLaneStatus(
          lanes.map((lane) => statuses[lane.laneId] ?? lane.status)
        );
        const active = tab.tabId === activeTabId;
        return (
          <div key={tab.tabId} className="group flex items-center">
            <Button
              role="tab"
              aria-selected={active}
              variant="ghost"
              size="sm"
              className={cn('h-7 gap-1.5 px-2', active && 'bg-(--em-accent-3) text-foreground')}
              onClick={() => navigate(lanesViewDef({ tabId: tab.tabId }))}
            >
              {aggregate && <LaneStatusLight status={aggregate} />}
              <span className="max-w-32 truncate">{tab.title}</span>
              <span className="text-xs text-foreground-muted">{lanes.length}</span>
            </Button>
            {lanes.length === 0 && board.tabs.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Close ${tab.title}`}
                onClick={() =>
                  void runLaneAction('Could not close the tab', (client) =>
                    client.removeTab({ tabId: tab.tabId })
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label="New tab"
            onClick={() => void addTab()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>New tab</Tooltip.Content>
      </Tooltip.Root>
    </div>
  );
});

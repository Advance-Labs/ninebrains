import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { createLayoutStorage } from '@core/primitives/mementos/browser/layout-storage';
import { useSubjectSpace } from '@core/primitives/mementos/react';
import { appSubject } from '@core/primitives/subjects/api';
import { disabled, enabled, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { useViewScope } from '@core/primitives/view-scopes/react';
import type { LaneSlot, LaneTab } from '../../api';
import { lanesViewScope } from '../../contributions/scopes';
import { useLaneStatuses } from '../use-lanes';
import { LaneCell } from './lane-cell';
import { LanesGridLayout } from './lanes-grid-layout';

/** One tab's grid: owns focus and maximize, and binds the lanes keyboard shortcuts. */
export const LanesGrid = observer(function LanesGrid({ tab }: { tab: LaneTab }) {
  const appSpace = useSubjectSpace(appSubject);
  const storage = useMemo(
    () => createLayoutStorage(appSpace, workbenchPanelLayoutsMemento),
    [appSpace]
  );
  const statuses = useLaneStatuses();
  const [focusedSlot, setFocusedSlot] = useState<LaneSlot>(0);
  const [maximizedSlot, setMaximizedSlot] = useState<LaneSlot | null>(null);

  const focus = (slot: LaneSlot) => () => ({ execute: () => setFocusedSlot(slot) });
  const implementation = {
    'lanes.focusLane1': focus(0),
    'lanes.focusLane2': focus(1),
    'lanes.focusLane3': focus(2),
    'lanes.focusLane4': focus(3),
    'lanes.toggleMaximize': () => ({
      availability: () => (tab.slots[focusedSlot] ? enabled : disabled('Focus a lane first')),
      execute: () => setMaximizedSlot((current) => (current === focusedSlot ? null : focusedSlot)),
    }),
  } satisfies ViewScopeImpl<typeof lanesViewScope>;
  const { attachRef } = useViewScope(lanesViewScope({}), implementation);

  if (!appSpace.isHydrated) return null;
  return (
    <div
      ref={attachRef}
      data-testid="lanes-grid"
      className="h-full w-full bg-background p-1"
      tabIndex={-1}
    >
      <LanesGridLayout
        tab={tab}
        storage={storage}
        maximizedSlot={maximizedSlot}
        renderCell={({ slot, lane, dimmed }) => (
          <LaneCell
            tabId={tab.tabId}
            slot={slot}
            lane={lane}
            status={lane ? (statuses[lane.laneId] ?? lane.status) : null}
            focused={focusedSlot === slot}
            dimmed={dimmed}
            maximized={maximizedSlot === slot}
            onFocus={() => setFocusedSlot(slot)}
            onToggleMaximize={() => setMaximizedSlot((current) => (current === slot ? null : slot))}
          />
        )}
      />
    </div>
  );
});

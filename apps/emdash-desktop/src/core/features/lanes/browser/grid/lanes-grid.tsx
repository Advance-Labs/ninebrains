import { EmptyState } from '@emdash/ui/react/components';
import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useState } from 'react';
import { workbenchPanelLayoutsMemento } from '@core/features/workbench/contributions/mementos';
import { createLayoutStorage } from '@core/primitives/mementos/browser/layout-storage';
import { useSubjectSpace } from '@core/primitives/mementos/react';
import { appSubject } from '@core/primitives/subjects/api';
import { disabled, enabled, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { LANE_SLOT_COUNT, type LaneSlot, type LaneTab } from '../../api';
import { lanesViewScope } from '../../contributions/scopes';
import { useLaneStatuses } from '../use-lanes';
import { openBrainDrawer } from './brain-drawer-state';
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
  const [formSlot, setFormSlot] = useState<LaneSlot | undefined>(undefined);

  const emptySlots = Array.from({ length: LANE_SLOT_COUNT }, (_, slot) => slot as LaneSlot).filter(
    (slot) => tab.slots[slot] === null
  );
  // One empty slot at a time shows the setup form; the rest are light "add lane" tiles. When the
  // form's slot fills, the form moves to the next empty slot.
  const activeFormSlot =
    formSlot !== undefined && emptySlots.includes(formSlot) ? formSlot : emptySlots[0];

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
  const { attachRef, instance } = useViewScope(lanesViewScope({}), implementation);

  // Logical scopes bind shortcuts only once activated (as the settings view does).
  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  if (!appSpace.isHydrated) return null;
  const isIntro = emptySlots.length === LANE_SLOT_COUNT && formSlot === undefined;
  return (
    <ViewScopeInstanceProvider instance={instance}>
      <div
        ref={attachRef}
        data-testid="lanes-grid"
        className="h-full w-full bg-background p-1"
        tabIndex={-1}
      >
        {isIntro ? (
          <LanesIntro onAddLane={() => setFormSlot(0)} />
        ) : (
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
                formActive={lane === null && slot === activeFormSlot}
                onActivateForm={() => setFormSlot(slot)}
                onFocus={() => setFocusedSlot(slot)}
                onToggleMaximize={() =>
                  setMaximizedSlot((current) => (current === slot ? null : slot))
                }
              />
            )}
          />
        )}
      </div>
    </ViewScopeInstanceProvider>
  );
});

/** First-run intro shown before any lane exists; "Add a lane" opens slot 1's form. */
export function LanesIntro({ onAddLane }: { onAddLane: () => void }) {
  return (
    <div data-testid="lanes-empty-intro" className="flex h-full w-full flex-col">
      <EmptyState
        label="Lanes run agents in parallel"
        description="Each lane runs one agent in its own copy of the project. The Planner draws the job plan, the Brain dispatches the jobs, and each lane works its own — start with a lane, then add more."
        action={
          <div className="flex items-center gap-2">
            <Button data-testid="lanes-add-first" onClick={onAddLane}>
              Add a lane
            </Button>
            <Button data-testid="lanes-intro-open-brain" variant="ghost" onClick={openBrainDrawer}>
              What does the Brain do?
            </Button>
          </div>
        }
      />
    </div>
  );
}

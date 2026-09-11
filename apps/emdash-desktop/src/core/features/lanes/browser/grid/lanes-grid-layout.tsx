import {
  Resizable,
  useResizableDefaultLayout,
  type LayoutStorage,
} from '@emdash/ui/react/primitives';
import { useMemo, type ReactNode } from 'react';
import type { Lane, LaneSlot, LaneTab } from '../../api';

const ROW_IDS = ['lanes-row-0', 'lanes-row-1'] as const;
const MAXIMIZED_SHARE = 80;

export type LaneCellRenderer = (input: {
  slot: LaneSlot;
  lane: Lane | null;
  dimmed: boolean;
}) => ReactNode;

function slotPanelId(slot: LaneSlot): string {
  return `lanes-slot-${slot}`;
}

/** In-memory storage for the maximized arrangement, which is not persisted. */
function createScratchStorage(): LayoutStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

/**
 * The 2×2 grid: a vertical group of two rows, each a horizontal group of two
 * slots. Sizes persist per tab through `storage`. Maximizing swaps in a
 * separate, unpersisted arrangement that gives one lane most of the space.
 */
export function LanesGridLayout({
  tab,
  storage,
  maximizedSlot,
  renderCell,
}: {
  tab: LaneTab;
  storage: LayoutStorage;
  maximizedSlot: LaneSlot | null;
  renderCell: LaneCellRenderer;
}) {
  const scratch = useMemo(() => createScratchStorage(), []);
  const maximized = maximizedSlot !== null;
  const prefix = maximized ? `lanes-max:${tab.tabId}:${maximizedSlot}` : `lanes:${tab.tabId}`;
  const layoutStorage = maximized ? scratch : storage;
  const rows = useResizableDefaultLayout({
    id: `${prefix}:rows`,
    panelIds: [...ROW_IDS],
    storage: layoutStorage,
  });

  const rowShare = (row: 0 | 1) => {
    const stored = rows.defaultLayout?.[ROW_IDS[row]];
    if (stored !== undefined) return stored;
    if (!maximized) return 50;
    return Math.floor(maximizedSlot / 2) === row ? MAXIMIZED_SHARE : 100 - MAXIMIZED_SHARE;
  };

  return (
    <Resizable.Group
      key={prefix}
      orientation="vertical"
      id={`${prefix}:rows`}
      defaultLayout={rows.defaultLayout}
      onLayoutChanged={rows.onLayoutChanged}
      className="h-full w-full"
    >
      {([0, 1] as const).map((row) => (
        <LaneRowPanel
          key={row}
          row={row}
          prefix={prefix}
          defaultSize={`${rowShare(row)}%`}
          storage={layoutStorage}
          tab={tab}
          maximizedSlot={maximizedSlot}
          renderCell={renderCell}
        />
      ))}
    </Resizable.Group>
  );
}

function LaneRowPanel({
  row,
  prefix,
  defaultSize,
  storage,
  tab,
  maximizedSlot,
  renderCell,
}: {
  row: 0 | 1;
  prefix: string;
  defaultSize: string;
  storage: LayoutStorage;
  tab: LaneTab;
  maximizedSlot: LaneSlot | null;
  renderCell: LaneCellRenderer;
}) {
  const slots = [(row * 2) as LaneSlot, (row * 2 + 1) as LaneSlot] as const;
  const groupId = `${prefix}:row-${row}`;
  const layout = useResizableDefaultLayout({
    id: groupId,
    panelIds: slots.map(slotPanelId),
    storage,
  });
  const slotShare = (slot: LaneSlot) => {
    const stored = layout.defaultLayout?.[slotPanelId(slot)];
    if (stored !== undefined) return stored;
    if (maximizedSlot === null || Math.floor(maximizedSlot / 2) !== row) return 50;
    return slot === maximizedSlot ? MAXIMIZED_SHARE : 100 - MAXIMIZED_SHARE;
  };

  return (
    <>
      {row === 1 && <Resizable.Handle />}
      <Resizable.Panel id={ROW_IDS[row]} defaultSize={defaultSize} minSize="12%">
        <Resizable.Group
          orientation="horizontal"
          id={groupId}
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          {slots.map((slot, index) => (
            <LaneSlotPanel key={slot} slot={slot} index={index} defaultSize={`${slotShare(slot)}%`}>
              {renderCell({
                slot,
                lane: tab.slots[slot] ?? null,
                dimmed: maximizedSlot !== null && maximizedSlot !== slot,
              })}
            </LaneSlotPanel>
          ))}
        </Resizable.Group>
      </Resizable.Panel>
    </>
  );
}

function LaneSlotPanel({
  slot,
  index,
  defaultSize,
  children,
}: {
  slot: LaneSlot;
  index: number;
  defaultSize: string;
  children: ReactNode;
}) {
  return (
    <>
      {index > 0 && <Resizable.Handle />}
      <Resizable.Panel id={slotPanelId(slot)} defaultSize={defaultSize} minSize="12%">
        {children}
      </Resizable.Panel>
    </>
  );
}

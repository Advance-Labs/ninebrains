import { ok } from '@emdash/shared';
import type { LayoutStorage } from '@emdash/ui/react/primitives';
import { createEventStreamHost } from '@emdash/wire/live';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import {
  lanesContract,
  lanesDomain,
  type Lane,
  type LaneBoard,
  type LaneSlot,
  type LaneStatusMap,
} from '../../api';
import { LaneStatusLight } from '../status-light';
import { resetLanesRemotesForTests, useLaneBoard, useLaneStatuses } from '../use-lanes';
import { LanesIntro } from './lanes-grid';
import { LanesGridLayout } from './lanes-grid-layout';

// Renders the grid layout from the lanes slice's own client and live models,
// seeded through `seedSliceWire`: no renderer host, no Electron, no main.

const nested = defineContract({ [lanesDomain]: lanesContract })[lanesDomain];

function lane(slot: LaneSlot, laneId: string): Lane {
  return {
    laneId,
    projectId: 'p1',
    taskId: `task-${laneId}`,
    conversationId: `conv-${laneId}`,
    provider: 'claude',
    model: null,
    accountLabel: null,
    browserId: `lane-${laneId}`,
    asleep: false,
    conversationReady: true,
    tabId: 'tab-1',
    slot,
    session: 'running',
    status: 'idle',
    projectName: 'Repo',
    branch: `lanes/${laneId}`,
    error: null,
  };
}

function memoryStorage(): LayoutStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, v) => void values.set(key, v),
  };
}

const ok0 = async () => ok(undefined);

function Harness({ maximizedSlot }: { maximizedSlot: LaneSlot | null }) {
  const { board } = useLaneBoard();
  const statuses = useLaneStatuses();
  const [storage] = useState(memoryStorage);
  const tab = board.tabs[0];
  if (!tab) return null;
  return (
    <div style={{ width: 1200, height: 800 }}>
      <LanesGridLayout
        tab={tab}
        storage={storage}
        maximizedSlot={maximizedSlot}
        renderCell={({ slot, lane: cellLane, dimmed }) => (
          <div
            data-testid="cell"
            data-slot={slot}
            data-dimmed={dimmed}
            data-lane={cellLane?.laneId}
          >
            {cellLane && <LaneStatusLight status={statuses[cellLane.laneId] ?? cellLane.status} />}
          </div>
        )}
      />
    </div>
  );
}

describe('lanes grid through the wire seam', () => {
  const board = cell<LaneBoard>({ tabs: [] });
  const statuses = cell<LaneStatusMap>({});
  let handle: { dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    board.set({
      tabs: [{ tabId: 'tab-1', title: 'Tab 1', slots: [lane(0, 'a'), null, null, lane(3, 'b')] }],
    });
    statuses.set({ a: 'idle', b: 'idle' });
    handle = seedSliceWire(lanesDomain, lanesContract, {
      board: expose(nested.board, { board }),
      statuses: expose(nested.statuses, { list: statuses }),
      events: createEventStreamHost(nested.events),
      createTab: async () => ok({ tabId: 'tab-2' }),
      renameTab: ok0,
      removeTab: ok0,
      createLane: async () => ok({ laneId: 'c' }),
      startLane: ok0,
      stopLane: ok0,
      relaunchLane: ok0,
      sleepLane: ok0,
      wakeLane: ok0,
      removeLane: ok0,
      moveLane: ok0,
      setLaneMode: ok0,
      setLaneRouting: ok0,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => {
      root.unmount();
    });
    container.remove();
    await resetLanesRemotesForTests();
    await handle.dispose();
  });

  const cells = () => [...container.querySelectorAll('[data-testid="cell"]')];
  const light = (laneId: string) =>
    container.querySelector(`[data-lane="${laneId}"] [data-status]`)?.getAttribute('data-status');

  it('renders four slots with lanes where the board has them', async () => {
    await act(async () => root.render(<Harness maximizedSlot={null} />));
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
    expect(cells().map((el) => el.getAttribute('data-lane'))).toEqual(['a', null, null, 'b']);
  });

  it('streams status lights live', async () => {
    await act(async () => root.render(<Harness maximizedSlot={null} />));
    await vi.waitFor(() => expect(light('a')).toBe('idle'));
    act(() => {
      statuses.set({ a: 'running', b: 'waiting' });
    });
    await vi.waitFor(() => expect(light('a')).toBe('running'));
    expect(light('b')).toBe('waiting');
  });

  it('dims every lane but the maximized one', async () => {
    await act(async () => root.render(<Harness maximizedSlot={3} />));
    await vi.waitFor(() => expect(cells()).toHaveLength(4));
    expect(cells().map((el) => el.getAttribute('data-dimmed'))).toEqual([
      'true',
      'true',
      'true',
      'false',
    ]);
  });

  it('introduces the view on a fresh tab with no lanes', async () => {
    const onAddLane = vi.fn();
    await act(async () => root.render(<LanesIntro onAddLane={onAddLane} />));
    const intro = container.querySelector('[data-testid="lanes-empty-intro"]');
    expect(intro).toBeTruthy();
    expect(intro?.textContent).toContain('Lanes run agents in parallel');
    expect(intro?.textContent).toContain('Add a lane');
  });

  it('opens the first lane form from the intro action', async () => {
    const onAddLane = vi.fn();
    await act(async () => root.render(<LanesIntro onAddLane={onAddLane} />));
    const button = container.querySelector<HTMLButtonElement>('[data-testid="lanes-add-first"]');
    expect(button).toBeTruthy();
    await act(async () => button?.click());
    expect(onAddLane).toHaveBeenCalledOnce();
  });
});

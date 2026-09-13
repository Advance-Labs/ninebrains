import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LaneSidePanelSource } from '../../api';
import { LaneSidePanel } from './lane-side-panel';

type Items = ReturnType<LaneSidePanelSource['list']>;

/**
 * Behaves like the Brain's source: every new subscription replays the lane's current data,
 * and each replay builds a fresh items array.
 */
function replayingSource() {
  let subscriptions = 0;
  let items: Items = [];
  const source: LaneSidePanelSource = {
    list: () => items,
    subscribe(_laneId, onChange) {
      subscriptions += 1;
      queueMicrotask(() => {
        items = [];
        onChange();
      });
      return () => undefined;
    },
  };
  return { source, subscriptions: () => subscriptions };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('LaneSidePanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('subscribes once, so a source that replays on subscribe cannot loop the renderer', async () => {
    const { source, subscriptions } = replayingSource();
    await act(async () => root.render(<LaneSidePanel laneId="lane-1" source={source} />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(subscriptions()).toBe(1);
    expect(host.textContent).toContain('Finished work for this lane shows up here.');
  });
});

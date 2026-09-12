import { createScope } from '@emdash/shared/concurrency';
import { observe, remote, type RemoteModel } from '@emdash/wire/state';
import type {
  LaneSidePanelItem,
  LaneSidePanelSource,
  LaneSidePanelTab,
} from '@core/features/lanes/api';
import { brainContract } from '../contract';
import { toSidePanelItems, type LanePanelData } from '../side-panel-items';
import { getBrainClient } from './client';

type LanePanelRemote = RemoteModel<typeof brainContract.lanePanel>;

let lanePanelRemote: Promise<LanePanelRemote> | undefined;
const defaultRemote = () => {
  lanePanelRemote ??= getBrainClient().then((client) =>
    remote(brainContract.lanePanel, client.lanePanel, { lingerMs: 15_000 })
  );
  return lanePanelRemote;
};

const EMPTY: readonly LaneSidePanelItem[] = [];

/**
 * `LaneSidePanelSource` over the Brain's `lanePanel` live model (Phase 2).
 * Items are cached per lane so `list` returns a stable array between updates,
 * as `useSyncExternalStore` requires.
 */
export function createBrainLaneSidePanelSource(
  getRemote: () => Promise<LanePanelRemote> = defaultRemote
): LaneSidePanelSource {
  const data = new Map<string, LanePanelData>();
  const items = new Map<string, Record<LaneSidePanelTab, LaneSidePanelItem[]>>();

  const update = (laneId: string, patch: Partial<LanePanelData>) => {
    const next = { jobs: [], done: [], notes: [], ...data.get(laneId), ...patch };
    data.set(laneId, next);
    items.set(laneId, {
      jobs: toSidePanelItems('jobs', next),
      done: toSidePanelItems('done', next),
      notes: toSidePanelItems('notes', next),
    });
  };

  return {
    list: (laneId, tab) => items.get(laneId)?.[tab] ?? EMPTY,
    subscribe(laneId, onChange) {
      const scope = createScope({ label: 'brain:lane-panel' });
      void (async () => {
        const model = await getRemote();
        if (scope.disposed) return;
        const { states } = model({ laneId });
        const apply = (patch: Partial<LanePanelData>) => {
          update(laneId, patch);
          onChange();
        };
        observe(states.jobs, (next) => next.value && apply({ jobs: next.value }), { scope });
        observe(states.done, (next) => next.value && apply({ done: next.value }), { scope });
        observe(states.notes, (next) => next.value && apply({ notes: next.value }), { scope });
      })().catch(() => undefined);
      return () => void scope.dispose();
    },
  };
}

/** One shared source for every lane cell. */
export const brainLaneSidePanelSource = createBrainLaneSidePanelSource();

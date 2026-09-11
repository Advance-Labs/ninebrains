/**
 * Read model behind a lane's side panel (Jobs / Done / Notes). Phase 1 ships
 * an empty source; Phase 2 implements it from the Brain DB.
 */
export type LaneSidePanelItem = {
  id: string;
  title: string;
  detail?: string;
  /** Epoch millis, for ordering and relative time. */
  at?: number;
  /** Short status tag, e.g. `unverified`, `verified`, `blocked`. */
  badge?: string;
};

export type LaneSidePanelTab = 'jobs' | 'done' | 'notes';

export interface LaneSidePanelSource {
  /** Current items for one lane and tab. */
  list(laneId: string, tab: LaneSidePanelTab): readonly LaneSidePanelItem[];
  /** Called when items may have changed; returns an unsubscribe. */
  subscribe(laneId: string, onChange: () => void): () => void;
}

export const emptyLaneSidePanelSource: LaneSidePanelSource = {
  list: () => [],
  subscribe: () => () => {},
};

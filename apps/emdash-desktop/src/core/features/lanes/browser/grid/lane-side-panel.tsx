import { Button } from '@emdash/ui/react/primitives';
import { useState, useSyncExternalStore } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  emptyLaneSidePanelSource,
  type LaneSidePanelSource,
  type LaneSidePanelTab,
} from '../../api';

const TABS: { id: LaneSidePanelTab; label: string; empty: string }[] = [
  { id: 'jobs', label: 'Jobs', empty: 'Jobs the Brain assigns to this lane show up here.' },
  { id: 'done', label: 'Done', empty: 'Finished work for this lane shows up here.' },
  {
    id: 'notes',
    label: 'Notes',
    empty: 'Notes the agent or you leave for this lane show up here.',
  },
];

/** Jobs / Done / Notes for one lane. Phase 1 renders the empty source. */
export function LaneSidePanel({
  laneId,
  source = emptyLaneSidePanelSource,
}: {
  laneId: string;
  source?: LaneSidePanelSource;
}) {
  const [tab, setTab] = useState<LaneSidePanelTab>('jobs');
  const items = useSyncExternalStore(
    (onChange) => source.subscribe(laneId, onChange),
    () => source.list(laneId, tab)
  );
  const active = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]!;

  return (
    <aside
      aria-label="Lane side panel"
      className="flex h-full w-52 shrink-0 flex-col border-l border-border bg-background-secondary"
    >
      <div role="tablist" className="flex gap-0.5 border-b border-border p-1">
        {TABS.map((candidate) => (
          <Button
            key={candidate.id}
            role="tab"
            aria-selected={candidate.id === tab}
            variant="ghost"
            size="sm"
            className={cn('h-6 flex-1 px-1 text-xs', candidate.id === tab && 'bg-(--em-accent-3)')}
            onClick={() => setTab(candidate.id)}
          >
            {candidate.label}
          </Button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="p-3 text-xs text-foreground-muted">{active.empty}</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md px-2 py-1 text-xs">
              <div className="truncate text-foreground">{item.title}</div>
              {item.detail && <div className="truncate text-foreground-muted">{item.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

import { Badge, Button, type BadgeTone } from '@emdash/ui/react/primitives';
import { useCallback, useState, useSyncExternalStore } from 'react';
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

function badgeTone(badge: string): BadgeTone {
  if (badge === 'verified') return 'success';
  if (badge === 'blocked') return 'error';
  if (badge === 'unverified' || badge === 'verifying') return 'warning';
  return 'neutral';
}

/** Jobs / Done / Notes for one lane, fed by the Brain's side-panel source. */
export function LaneSidePanel({
  laneId,
  source = emptyLaneSidePanelSource,
}: {
  laneId: string;
  source?: LaneSidePanelSource;
}) {
  const [tab, setTab] = useState<LaneSidePanelTab>('jobs');
  // A stable subscribe: an inline one re-subscribes on every render, and each new subscription
  // replays the lane's current data, which renders again, so the renderer never went idle.
  const subscribe = useCallback(
    (onChange: () => void) => source.subscribe(laneId, onChange),
    [source, laneId]
  );
  const items = useSyncExternalStore(subscribe, () => source.list(laneId, tab));
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
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-foreground">{item.title}</span>
                {item.badge && (
                  <Badge className="ml-auto shrink-0" tone={badgeTone(item.badge)}>
                    {item.badge}
                  </Badge>
                )}
              </div>
              {item.detail && <div className="truncate text-foreground-muted">{item.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

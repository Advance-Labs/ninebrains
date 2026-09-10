import { EmptyState } from '@emdash/ui/react/components';
import { Button, Spinner } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import type { Lane, LaneSlot, LaneStatus } from '../../api';
import { LaneTerminal } from '../lane-terminal';
import { LaneStatusLight } from '../status-light';
import { runLaneAction } from '../use-lanes';
import { AddLaneForm } from './add-lane-form';
import { LaneBrowser } from './lane-browser';
import { LaneHeader } from './lane-header';
import { LaneSidePanel } from './lane-side-panel';

export function LaneCell({
  tabId,
  slot,
  lane,
  status,
  focused,
  dimmed,
  maximized,
  onFocus,
  onToggleMaximize,
}: {
  tabId: string;
  slot: LaneSlot;
  lane: Lane | null;
  status: LaneStatus | null;
  focused: boolean;
  dimmed: boolean;
  maximized: boolean;
  onFocus: () => void;
  onToggleMaximize: () => void;
}) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  return (
    <section
      data-testid="lane-cell"
      data-slot={slot}
      data-focused={focused}
      aria-label={
        lane ? `Lane ${slot + 1}: ${lane.projectName ?? 'project'}` : `Empty slot ${slot + 1}`
      }
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      className={cn(
        '@container flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border bg-background transition-opacity',
        focused ? 'border-(--em-accent-8)' : 'border-border',
        dimmed && 'opacity-40'
      )}
    >
      {!lane ? (
        <AddLaneForm tabId={tabId} slot={slot} />
      ) : (
        <>
          <LaneHeader
            lane={lane}
            status={status ?? lane.status}
            maximized={maximized}
            browserOpen={browserOpen}
            sidePanelOpen={sidePanelOpen}
            onToggleBrowser={() => setBrowserOpen((open) => !open)}
            onToggleSidePanel={() => setSidePanelOpen((open) => !open)}
            onToggleMaximize={onToggleMaximize}
          />
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <LaneBody lane={lane} focused={focused} browserOpen={browserOpen} />
            </div>
            {sidePanelOpen && <LaneSidePanel laneId={lane.laneId} />}
          </div>
        </>
      )}
    </section>
  );
}

function LaneBody({
  lane,
  focused,
  browserOpen,
}: {
  lane: Lane;
  focused: boolean;
  browserOpen: boolean;
}) {
  const laneKey = { laneId: lane.laneId };
  if (lane.asleep) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          label="Asleep"
          description="The agent keeps running while the lane is hidden."
          action={
            <Button
              onClick={() =>
                void runLaneAction('Could not wake the lane', (c) => c.wakeLane(laneKey))
              }
            >
              <LaneStatusLight status="asleep" /> Wake
            </Button>
          }
        />
      </div>
    );
  }
  if (browserOpen) return <LaneBrowser lane={lane} />;
  switch (lane.session) {
    case 'running':
      return <LaneTerminal key={lane.conversationId} lane={lane} focused={focused} />;
    case 'starting':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-foreground-muted">
          <Spinner size="sm" />
          Preparing the worktree and starting the agent…
        </div>
      );
    case 'failed':
      return (
        <div className="flex h-full items-center justify-center p-4">
          <EmptyState
            label="The lane could not start"
            description={lane.error ?? 'Check the project and try again.'}
            action={
              <Button
                onClick={() =>
                  void runLaneAction('Could not start the agent', (c) => c.startLane(laneKey))
                }
              >
                Try again
              </Button>
            }
          />
        </div>
      );
    case 'stopped':
      return (
        <div className="flex h-full items-center justify-center p-4">
          <EmptyState
            label="Agent stopped"
            description="The worktree is kept. Start the agent to pick up where it left off."
            action={
              <Button
                onClick={() =>
                  void runLaneAction('Could not start the agent', (c) => c.startLane(laneKey))
                }
              >
                Start agent
              </Button>
            }
          />
        </div>
      );
  }
}

import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { ConfirmationDialog } from '@emdash/ui/react/components';
import { Badge, Button, DropdownMenu, Tooltip } from '@emdash/ui/react/primitives';
import {
  Ellipsis,
  FilePen,
  Globe,
  Maximize2,
  Minimize2,
  Moon,
  PanelRight,
  Play,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useAgentHooksStatus } from '@core/features/agents/api/browser/use-agent-hooks-status';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { LANE_SLOT_COUNT, type Lane, type LaneSlot, type LaneStatus } from '../../api';
import { laneStatusLabel, LaneStatusLight } from '../status-light';
import { runLaneAction } from '../use-lanes';

// Below this header width the lower-priority actions live only in the lane menu.
const NARROW_HEADER_PX = 480;

/** Tracks whether an element is narrower than `threshold`. Components own their display CSS, so this is JS. */
function useIsNarrow(ref: RefObject<HTMLElement | null>, threshold: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < threshold);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return narrow;
}

const PROVIDER_LABELS: Record<Lane['provider'], string> = { claude: 'Claude', codex: 'Codex' };

function HeaderButton({
  label,
  pressed,
  hidden,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  hidden?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          variant="ghost"
          size="sm"
          className={cn('size-6 shrink-0 p-0', pressed && 'bg-(--em-accent-3)')}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

export function LaneHeader({
  lane,
  status,
  maximized,
  browserOpen,
  sidePanelOpen,
  onToggleBrowser,
  onToggleSidePanel,
  onToggleMaximize,
}: {
  lane: Lane;
  status: LaneStatus;
  maximized: boolean;
  browserOpen: boolean;
  sidePanelOpen: boolean;
  onToggleBrowser: () => void;
  onToggleSidePanel: () => void;
  onToggleMaximize: () => void;
}) {
  const { navigate } = useNavigate();
  const hooks = useAgentHooksStatus(lane.provider, LOCAL_HOST_REF, true);
  const hooksMissing = hooks.isError || hooks.status?.state === 'pending-install';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = lane.session === 'running' || lane.session === 'starting';
  const laneKey = { laneId: lane.laneId };
  const headerRef = useRef<HTMLElement>(null);
  const narrow = useIsNarrow(headerRef, NARROW_HEADER_PX);

  return (
    <header
      ref={headerRef}
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background-secondary px-2"
    >
      <LaneStatusLight status={status} />
      <span className="sr-only">{laneStatusLabel(status)}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {lane.projectName ?? 'Project'}
        </span>
        <span className="hidden truncate font-mono text-xs text-foreground-muted @[22rem]:inline">
          {lane.branch}
        </span>
        <Badge variant="outline" tone="neutral" className="shrink-0">
          {PROVIDER_LABELS[lane.provider]}
        </Badge>
        {hooksMissing && (
          <Tooltip.Root>
            <Tooltip.Trigger>
              <TriangleAlert
                aria-label="Status lights unavailable"
                className="h-3.5 w-3.5 shrink-0 text-foreground-warning"
              />
            </Tooltip.Trigger>
            <Tooltip.Content>
              Status lights unavailable: this agent's hooks are not installed yet.
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <HeaderButton
          label={live ? 'Stop agent' : 'Start agent'}
          onClick={() =>
            void runLaneAction(
              live ? 'Could not stop the agent' : 'Could not start the agent',
              (c) => (live ? c.stopLane(laneKey) : c.startLane(laneKey))
            )
          }
        >
          {live ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </HeaderButton>
        <HeaderButton label="Browser" pressed={browserOpen} onClick={onToggleBrowser}>
          <Globe className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton
          label="Open in editor"
          hidden={narrow}
          onClick={() => navigate(taskViewDef({ projectId: lane.projectId, taskId: lane.taskId }))}
        >
          <FilePen className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton
          label="Jobs, done and notes"
          hidden={narrow}
          pressed={sidePanelOpen}
          onClick={onToggleSidePanel}
        >
          <PanelRight className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton
          label="Sleep (keeps the agent running)"
          hidden={narrow}
          onClick={() =>
            void runLaneAction('Could not put the lane to sleep', (c) => c.sleepLane(laneKey))
          }
        >
          <Moon className="h-3.5 w-3.5" />
        </HeaderButton>
        <HeaderButton label={maximized ? 'Restore' : 'Maximize'} onClick={onToggleMaximize}>
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </HeaderButton>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="ghost" size="sm" className="size-6 p-0" aria-label="Lane menu">
              <Ellipsis className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              onClick={() =>
                void runLaneAction('Could not relaunch the agent', (c) => c.relaunchLane(laneKey))
              }
            >
              Relaunch agent
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onClick={() =>
                navigate(taskViewDef({ projectId: lane.projectId, taskId: lane.taskId }))
              }
            >
              Open in editor
            </DropdownMenu.Item>
            <DropdownMenu.Item onClick={onToggleSidePanel}>
              {sidePanelOpen ? 'Hide jobs, done and notes' : 'Show jobs, done and notes'}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onClick={() =>
                void runLaneAction('Could not put the lane to sleep', (c) => c.sleepLane(laneKey))
              }
            >
              Sleep (keeps the agent running)
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            {Array.from({ length: LANE_SLOT_COUNT }, (_, slot) => slot as LaneSlot)
              .filter((slot) => slot !== lane.slot)
              .map((slot) => (
                <DropdownMenu.Item
                  key={slot}
                  onClick={() =>
                    void runLaneAction('Could not move the lane', (c) =>
                      c.moveLane({ ...laneKey, tabId: lane.tabId, slot })
                    )
                  }
                >
                  Move to slot {slot + 1}
                </DropdownMenu.Item>
              ))}
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onClick={() =>
                void runLaneAction('Could not remove the lane', (c) =>
                  c.removeLane({ ...laneKey, deleteWorktree: false })
                )
              }
            >
              Remove lane (keep worktree)
            </DropdownMenu.Item>
            <DropdownMenu.Item onClick={() => setConfirmDelete(true)}>
              Remove lane and delete worktree…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lane's worktree?"
        description={`This stops the agent and deletes the worktree on ${lane.branch ?? 'its branch'}. Uncommitted changes are lost.`}
        confirmLabel="Delete worktree"
        tone="destructive"
        onConfirm={async () => {
          await runLaneAction('Could not remove the lane', (c) =>
            c.removeLane({ ...laneKey, deleteWorktree: true })
          );
          setConfirmDelete(false);
        }}
      />
    </header>
  );
}

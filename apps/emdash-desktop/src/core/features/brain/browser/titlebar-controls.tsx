import { Badge, Button, Tooltip } from '@emdash/ui/react/primitives';
import { stopAllAgentWork } from '../contributions/stop-action';
import { useBrainOverview } from './use-brain';

/** Lanes titlebar: the Brain drawer toggle (with the unread total) and the global STOP. */
export function BrainTitlebarControls({
  drawerOpen,
  onToggleDrawer,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  const { unread, dispatcher } = useBrainOverview();
  const total = Object.values(unread).reduce((sum, count) => sum + count, 0);
  const status = dispatcher.stopLatched ? 'stopped' : dispatcher.paused ? 'paused' : 'dispatching';
  return (
    <div className="flex items-center gap-1 pr-2">
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={drawerOpen}
              data-testid="brain-drawer-toggle"
              onClick={onToggleDrawer}
            >
              Brain
              {total > 0 && <Badge tone="info">{total}</Badge>}
            </Button>
          }
        />
        <Tooltip.Content>
          {status}
          {total > 0 && ` · ${total} unread`}
        </Tooltip.Content>
      </Tooltip.Root>
      <BrainStopButton />
    </div>
  );
}

/**
 * The global STOP on its own, so every view that can be open while agents run can carry it.
 * The Planner in particular is reachable from Lanes but renders its own titlebar, so without
 * this it was the one place you could watch a plan run with no way to stop it.
 */
export function BrainStopButton() {
  const { dispatcher } = useBrainOverview();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            size="sm"
            variant="destructive"
            data-testid="brain-stop"
            disabled={dispatcher.stopLatched}
            onClick={() => void stopAllAgentWork()}
          >
            {dispatcher.stopLatched ? 'Stopped' : 'STOP'}
          </Button>
        }
      />
      <Tooltip.Content>
        STOP: stop every agent and pause dispatching until you clear it (Mod+Shift+Backspace).
      </Tooltip.Content>
    </Tooltip.Root>
  );
}

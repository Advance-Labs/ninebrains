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
  return (
    <div className="flex items-center gap-1 pr-2">
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
    </div>
  );
}

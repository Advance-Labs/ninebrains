import { Badge, Switch } from '@emdash/ui/react/primitives';
import { runBrainAction, useBrainOverview } from '@core/features/brain/contributions/settings';
import { SettingRow } from './SettingRow';

/** Explains what the Brain does and surfaces its live dispatch state, with a pause switch. */
export function BrainSettingsCard() {
  const { dispatcher, sessions } = useBrainOverview();
  const running = sessions.length;

  return (
    <SettingRow
      title="Brain"
      description={
        <div className="space-y-1.5">
          <p>
            The Brain coordinates agents across your lanes: it plans jobs, hands them to lanes, and
            tracks what&apos;s done, blocked, or waiting.
          </p>
          <div className="flex items-center gap-1.5">
            <Badge
              tone={dispatcher.stopLatched ? 'error' : dispatcher.paused ? 'warning' : 'success'}
            >
              {dispatcher.stopLatched ? 'stopped' : dispatcher.paused ? 'paused' : 'dispatching'}
            </Badge>
            <span className="text-xs text-foreground-muted">
              {running === 0
                ? 'No Brain sessions running yet — start one from a lanes tab.'
                : `${running} Brain session${running === 1 ? '' : 's'} running`}
            </span>
          </div>
          {dispatcher.stopLatched && (
            <p className="text-xs text-foreground-muted">
              STOP is latched — clear it from the Brain drawer or the titlebar before dispatch can
              resume.
            </p>
          )}
        </div>
      }
      control={
        <Switch
          checked={!dispatcher.stopLatched && !dispatcher.paused}
          disabled={dispatcher.stopLatched}
          aria-label="Brain dispatches jobs to lanes"
          onCheckedChange={(checked) =>
            void runBrainAction('Could not change dispatch', (client) =>
              client.setDispatcherPaused({ paused: !checked })
            )
          }
        />
      }
    />
  );
}

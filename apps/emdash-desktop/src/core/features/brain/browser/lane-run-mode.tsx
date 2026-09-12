import { ConfirmationDialog } from '@emdash/ui/react/components';
import { Badge, Button, Tooltip } from '@emdash/ui/react/primitives';
import { Hand } from 'lucide-react';
import { useState } from 'react';
import type { LaneProvider, LaneRunMode } from '@core/features/lanes/api';
import type { BrainRunBudgetsView } from '../api';
import { runBrainAction, useBrainOverview } from './use-brain';

const HEADLESS_COMMAND: Record<LaneProvider, string> = {
  claude: 'claude -p',
  codex: 'codex exec',
};

function minutes(ms: number): string {
  const whole = Math.round(ms / 60_000);
  return `${whole} min`;
}

/** "30 min wall clock, 60 turns, $5 spend" from whatever budgets are set. */
export function describeBudgets(budgets: BrainRunBudgetsView): string {
  const parts = [`${minutes(budgets.wallClockMs)} wall clock`];
  if (budgets.maxTurns !== undefined) parts.push(`${budgets.maxTurns} turns`);
  if (budgets.maxTokens !== undefined) parts.push(`${budgets.maxTokens.toLocaleString()} tokens`);
  if (budgets.maxBudgetUsd !== undefined) parts.push(`$${budgets.maxBudgetUsd} spend`);
  return parts.join(', ');
}

export function unattendedSummary(provider: LaneProvider, budgets: BrainRunBudgetsView): string {
  const experimental = provider === 'codex' ? ' (experimental for Codex)' : '';
  return (
    `Each Brain job runs headless with \`${HEADLESS_COMMAND[provider]}\`${experimental}: no terminal ` +
    `and no permission prompts. The sandbox and an allowed-tools preset limit what it can do. ` +
    `Budget per run: ${describeBudgets(budgets)}.`
  );
}

/**
 * The lane's run mode in its header (SEAMS §3.8). Attended, the default, shows a quiet toggle.
 * Unattended shows a warning badge that names the headless command and its budgets, so it is
 * never mistaken for a lane you are watching. Switching to unattended asks first.
 */
export function LaneRunModeControl({
  laneId,
  provider,
  mode,
}: {
  laneId: string;
  provider: LaneProvider;
  mode: LaneRunMode;
}) {
  const { dispatcher } = useBrainOverview();
  const [confirming, setConfirming] = useState(false);
  const summary = unattendedSummary(provider, dispatcher.unattendedBudgets);
  const setMode = (next: LaneRunMode) =>
    runBrainAction('Could not change how this lane runs', (client) =>
      client.setLaneMode({ laneId, mode: next })
    );

  return (
    <>
      {mode === 'unattended' ? (
        <Tooltip.Root>
          <Tooltip.Trigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1"
              aria-label="Unattended: switch back to attended"
              data-testid="lane-run-mode"
              data-mode="unattended"
              onClick={() => void setMode('attended')}
            >
              <Badge tone="warning">Unattended · {HEADLESS_COMMAND[provider]}</Badge>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content className="max-w-80">
            {summary} Click to switch back to attended.
          </Tooltip.Content>
        </Tooltip.Root>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger>
            <Button
              variant="ghost"
              size="sm"
              className="size-6 shrink-0 p-0"
              aria-label="Attended: run Brain jobs unattended…"
              data-testid="lane-run-mode"
              data-mode="attended"
              onClick={() => setConfirming(true)}
            >
              <Hand className="h-3.5 w-3.5" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content className="max-w-80">
            Attended: Brain jobs are pasted into this terminal for you to watch. Click to run them
            unattended.
          </Tooltip.Content>
        </Tooltip.Root>
      )}
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Run this lane's Brain jobs unattended?"
        description={`${summary} Jobs you start yourself in the terminal are not affected. STOP ends every unattended run.`}
        confirmLabel="Run unattended"
        onConfirm={async () => {
          await setMode('unattended');
          setConfirming(false);
        }}
      />
    </>
  );
}

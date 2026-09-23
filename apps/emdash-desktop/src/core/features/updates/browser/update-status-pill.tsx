import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type { JSX } from 'react';
import type { ReactNode } from 'react';
import { getUpdateStore } from '../contributions/app-stores';
import { BrandLoadingMark } from './brand-loading-mark';

/**
 * Bottom-right update status pill. Appears whenever an update check is in flight or produced a
 * state worth surfacing, and disappears once the update is not available. Download is explicit —
 * nothing is fetched until the user asks.
 */
export const UpdateStatusPill = observer(function UpdateStatusPill(): JSX.Element | null {
  const update = getUpdateStore();
  const { state } = update;

  switch (state.status) {
    case 'idle':
    case 'not-available':
      return null;
    case 'checking':
      return (
        <Pill>
          <BrandLoadingMark size={18} />
          <span>Checking for updates…</span>
        </Pill>
      );
    case 'available':
      return (
        <Pill>
          <BrandLoadingMark size={18} />
          <span className="text-foreground">
            <span className="font-medium">v{versionLabel(update)} available</span>
            <span className="block text-[11px] text-foreground-passive">Ninebrains</span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.download()}>
            Download
          </Button>
        </Pill>
      );
    case 'downloading':
      return (
        <Pill>
          <BrandLoadingMark size={18} />
          <span className="text-foreground">
            <span className="font-medium">Downloading update</span>
            <span className="block text-[11px] text-foreground-passive">
              {update.progressLabel || 'starting…'}
            </span>
          </span>
        </Pill>
      );
    case 'downloaded':
      return (
        <Pill>
          <span className="text-foreground">
            <span className="font-medium">Update ready</span>
            <span className="block text-[11px] text-foreground-passive">
              restarts on next launch
            </span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.install()}>
            Restart now
          </Button>
        </Pill>
      );
    case 'installing':
      return (
        <Pill>
          <BrandLoadingMark size={18} />
          <span>Installing update…</span>
        </Pill>
      );
    case 'error':
      return (
        <Pill>
          <span className="text-foreground">
            <span className="font-medium text-foreground-destructive">Update failed</span>
            <span className="block overflow-hidden text-[11px] text-ellipsis text-foreground-passive">
              {state.message || 'could not apply the update'}
            </span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.check()}>
            Retry
          </Button>
        </Pill>
      );
  }
});

function versionLabel(update: {
  availableVersion?: string;
  state: { status: string; info?: { version?: string } };
}): string {
  return (
    update.availableVersion ??
    (update.state.status === 'available' ? update.state.info?.version : '') ??
    ''
  );
}

function Pill({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="pointer-events-auto fixed right-4 bottom-4 z-50 flex max-w-xs items-center gap-2.5 rounded-full border border-border/60 bg-background-1 py-2 pr-2 pl-3 text-xs shadow-lg">
      {children}
    </div>
  );
}

import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import type { JSX, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { getUpdateStore } from '../contributions/app-stores';
import { BrandLoadingMark } from './brand-loading-mark';

/** How long the exit animation runs before the pill unmounts; keep in sync with the CSS below. */
const EXIT_ANIMATION_MS = 200;

type UpdateStoreLike = ReturnType<typeof getUpdateStore>;

/**
 * Bottom-right update status pill. Appears while an update check is in flight or produced a state
 * worth surfacing, and animates away once there is nothing to show (no update, or idle) rather than
 * lingering on "Checking…". Download is explicit — nothing is fetched until the user asks.
 */
export const UpdateStatusPill = observer(function UpdateStatusPill(): JSX.Element | null {
  const update = getUpdateStore();
  const body = pillBody(update);
  const visible = body !== null;

  // Keep the last rendered body around so it can play the exit animation after `body` goes null.
  const lastBodyRef = useRef<ReactNode>(null);
  if (body !== null) lastBodyRef.current = body;

  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Flip to shown on the next frame so the enter transition actually runs from the hidden state.
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      data-visible={shown ? 'true' : 'false'}
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-xs items-center gap-2.5 rounded-full border border-border/60 bg-background-1 py-2 pr-2 pl-3 text-xs shadow-lg transition-[opacity,transform] duration-200 ease-out data-[visible=false]:translate-y-2 data-[visible=false]:opacity-0 data-[visible=true]:pointer-events-auto data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100"
    >
      {body ?? lastBodyRef.current}
    </div>
  );
});

function pillBody(update: UpdateStoreLike): ReactNode | null {
  const { state } = update;
  switch (state.status) {
    case 'idle':
    case 'not-available':
      return null;
    case 'checking':
      return (
        <>
          <BrandLoadingMark size={18} />
          <span>Checking for updates…</span>
        </>
      );
    case 'available':
      return (
        <>
          <BrandLoadingMark size={18} />
          <span className="text-foreground">
            <span className="font-medium">v{versionLabel(update)} available</span>
            <span className="block text-[11px] text-foreground-passive">Ninebrains</span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.download()}>
            Download
          </Button>
        </>
      );
    case 'downloading':
      return (
        <>
          <BrandLoadingMark size={18} />
          <span className="text-foreground">
            <span className="font-medium">Downloading update</span>
            <span className="block text-[11px] text-foreground-passive">
              {update.progressLabel || 'starting…'}
            </span>
          </span>
        </>
      );
    case 'downloaded':
      return (
        <>
          <span className="text-foreground">
            <span className="font-medium">Update ready</span>
            <span className="block text-[11px] text-foreground-passive">
              restarts on next launch
            </span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.install()}>
            Restart now
          </Button>
        </>
      );
    case 'installing':
      return (
        <>
          <BrandLoadingMark size={18} />
          <span>Installing update…</span>
        </>
      );
    case 'error':
      return (
        <>
          <span className="text-foreground">
            <span className="font-medium text-foreground-destructive">Update failed</span>
            <span className="block overflow-hidden text-[11px] text-ellipsis text-foreground-passive">
              {state.message || 'could not apply the update'}
            </span>
          </span>
          <Button size="xs" variant="secondary" onClick={() => void update.check()}>
            Retry
          </Button>
        </>
      );
  }
}

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

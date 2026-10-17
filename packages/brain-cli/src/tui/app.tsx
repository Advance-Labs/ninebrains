import { Box, useStdout } from 'ink';
import React, { useEffect, useState } from 'react';
import { Feed } from './components/feed';
import { Header } from './components/header';
import { OverlayView, overlayLength } from './components/overlay';
import { Prompt } from './components/prompt';
import { StatusLine } from './components/status-line';
import { WorkingRow } from './components/working-row';
import { useBrainStore } from './store';

/** Header, prompt box (3 rows), status line and the header's rule. */
const CHROME_ROWS = 7;

/**
 * Header, then the feed (or an overlay list over it), then the prompt and one status line.
 * No key does anything on its own: actions are slash commands typed into the prompt.
 */
export function App() {
  const store = useBrainStore();
  const { stdout } = useStdout();
  const width = stdout.columns ?? 80;
  const working = store.busySince !== null ? 1 : 0;
  const bodyRows = Math.max((stdout.rows ?? 24) - CHROME_ROWS - working, 3);
  const [offset, setOffset] = useState(0);

  useEffect(() => setOffset(0), [store.overlay]);

  const scroll = (direction: -1 | 1) => {
    if (!store.overlay) return;
    const max = Math.max(overlayLength(store.overlay, store) - 1, 0);
    setOffset((o) => Math.min(Math.max(o + direction, 0), max));
  };

  return (
    <Box flexDirection="column" height={stdout.rows ?? 24} width={width}>
      <Header width={width} />
      {store.overlay ? (
        <OverlayView overlay={store.overlay} rows={bodyRows} offset={offset} />
      ) : (
        <Feed rows={bodyRows} />
      )}
      <WorkingRow />
      <Prompt
        onSubmit={(line) => void store.submit(line)}
        onEscape={store.closeOverlay}
        {...(store.overlay ? { onArrow: scroll } : {})}
      />
      <StatusLine />
    </Box>
  );
}

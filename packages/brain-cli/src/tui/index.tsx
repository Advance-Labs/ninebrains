import { render } from 'ink';
import React from 'react';
import type { Connection } from '../connect';
import { App } from './app';
import { BrainStoreProvider } from './store';

export function runTui(connection: Connection, projectId: string | undefined): void {
  render(
    <BrainStoreProvider client={connection.client} projectId={projectId}>
      <App />
    </BrainStoreProvider>,
    // Full screen, like Claude Code and Codex: the shell line that launched it is hidden while the
    // TUI runs, and the shell comes back untouched on /quit. Ink ignores this when not interactive.
    { alternateScreen: true }
  );
}

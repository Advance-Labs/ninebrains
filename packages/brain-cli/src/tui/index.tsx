import { render } from 'ink';
import React from 'react';
import type { Connection } from '../connect';
import { App } from './app';
import { BrainStoreProvider } from './store';

export function runTui(connection: Connection, projectId: string | undefined): void {
  render(
    <BrainStoreProvider client={connection.client} projectId={projectId}>
      <App />
    </BrainStoreProvider>
  );
}

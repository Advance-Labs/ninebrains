#!/usr/bin/env node
// Keep first: it must run before anything loads node:sqlite.
import './quiet-warnings';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Brain, SqliteBrainStore } from '@ninebrains/brain-core';
import { ConfigError, loadConfig } from './config';
import { createBrainMcpServer } from './server';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`ninebrains-brain-mcp: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }

  const brain = new Brain({ store: SqliteBrainStore.open(config.dbPath) });
  const server = createBrainMcpServer({ brain, config });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => {
      brain.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`ninebrains-brain-mcp: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});

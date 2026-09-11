#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { forwardBackend } from './backend';
import { ConfigError, loadConfig } from './config';
import { createBrainMcpServer } from './server';
import { SessionError, discoverSession } from './session';

function fail(code: number, message: string): never {
  process.stderr.write(`ninebrains-brain-mcp: ${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) fail(2, error.message);
    throw error;
  }

  const backend = forwardBackend(config);
  let session;
  try {
    session = await discoverSession(backend);
  } catch (error) {
    if (error instanceof SessionError) fail(1, error.message);
    throw error;
  }

  const server = createBrainMcpServer({ backend, role: session.role });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => {
      backend.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  fail(1, error instanceof Error ? error.message : String(error));
});

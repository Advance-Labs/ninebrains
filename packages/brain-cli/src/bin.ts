#!/usr/bin/env node
import { runCli } from './cli';
import { runTui } from './tui';

const code = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
  launchTui: (connection, projectId) => {
    runTui(connection, projectId);
  },
});
process.exitCode = code;

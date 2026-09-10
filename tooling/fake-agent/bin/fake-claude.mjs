#!/usr/bin/env node
// fake-claude: impersonates the `claude` CLI for tests. See ../README section in
// docs/SPIKE-EXEC-PATHS.md. Env:
//   FAKE_AGENT_SCRIPT      path to (or inline) JSON script of steps
//   FAKE_AGENT_ARGV_LOG    append {argv, cwd, laneId} per launch, to assert launch commands
//   FAKE_AGENT_RATE_LIMIT  e.g. {"five_hour":0.4,"seven_day":0.5} -> emits a rate_limit_event
import { appendFileSync } from 'node:fs';
import { ArgError, parseArgs } from '../src/args.mjs';
import { FAKE_VERSION } from '../src/events.mjs';
import { openSession } from '../src/session.mjs';
import { loadScript } from '../src/steps.mjs';
import { runPrintMode } from '../src/print-mode.mjs';
import { runInteractiveMode } from '../src/interactive-mode.mjs';

const USAGE = `Usage: fake-claude [options] [prompt]

Stand-in for the claude CLI. Supported: -p, --output-format, --input-format,
--verbose, --mcp-config, --strict-mcp-config, --model, --allowedTools,
--disallowedTools, --tools, --append-system-prompt, --system-prompt, --resume,
--continue, --session-id, --max-turns, --permission-mode, --settings,
--setting-sources, --add-dir, --dangerously-skip-permissions.
`;

export async function main(argv, { env = process.env, io = process, cwd = process.cwd() } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      io.stderr.write(err.message + '\n');
      return 1;
    }
    throw err;
  }
  if (env.FAKE_AGENT_ARGV_LOG) {
    appendFileSync(env.FAKE_AGENT_ARGV_LOG, JSON.stringify({ argv, cwd, laneId: env.LANE_ID ?? null }) + '\n');
  }
  if (opts.help) {
    io.stdout.write(USAGE);
    return 0;
  }
  if (opts.version) {
    io.stdout.write(`${FAKE_VERSION} (Fake Claude Code)\n`);
    return 0;
  }
  const steps = loadScript(env.FAKE_AGENT_SCRIPT);
  const deps = { steps, io, env, openSession: () => openSession(opts, { cwd, env }) };
  return opts.print ? runPrintMode(opts, deps) : runInteractiveMode(opts, deps);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fake-claude: ${err.message}\n`);
    process.exit(1);
  }
);

import type { BrainResponse } from '@ninebrains/brain-core';
import { parseArgs, UsageError } from './args';
import { COMMANDS, commandNames, type CommandContext } from './commands';
import { connect, type Connection } from './connect';

/**
 * The CLI, as a function. `bin.ts` only supplies process argv, env and streams,
 * so every path below is testable without spawning anything.
 *
 * Exit codes, because this runs in scripts:
 *   0  the endpoint answered ok
 *   1  the endpoint answered an error (the job does not exist, STOP is latched, ...)
 *   2  usage: unknown command, missing argument, bad address
 *   3  no Brain to talk to
 */
export const EXIT = { ok: 0, failed: 1, usage: 2, unreachable: 3 } as const;

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

export interface CliDeps {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  io: CliIo;
  /** Overridden in tests to avoid a real endpoint. */
  connect?: (env: NodeJS.ProcessEnv) => ReturnType<typeof connect>;
  /** Launches the interactive TUI when no command is given. */
  launchTui?: (connection: Connection, projectId: string | undefined) => void;
}

export async function runCli(deps: CliDeps): Promise<number> {
  const { argv, env, io } = deps;
  const args = parseArgs(argv);
  const json = args.flags.has('json');
  const name = args.positionals[0];

  if (name === undefined || args.flags.has('help') || name === 'help') {
    if (name === undefined && !args.flags.has('help') && deps.launchTui) {
      const connection = (deps.connect ?? connect)(env);
      if (!connection.ok) {
        io.err(connection.message);
        return EXIT.unreachable;
      }
      deps.launchTui(connection.connection, env.NINEBRAINS_PROJECT);
      return EXIT.ok;
    }
    io.out(helpText());
    // Asking for help is success; not saying what you wanted is not.
    return name === undefined && !args.flags.has('help') ? EXIT.usage : EXIT.ok;
  }

  const command = COMMANDS[name];
  if (!command) {
    io.err(`brain: unknown command "${name}"`);
    io.err(`Try one of: ${commandNames().join(', ')}`);
    return EXIT.usage;
  }

  const context: CommandContext = { defaultProject: env.NINEBRAINS_PROJECT };
  // The verb itself is positional 0, so each command sees its own arguments only.
  const commandArgs = { positionals: args.positionals.slice(1), flags: args.flags };

  let request;
  try {
    request = command.build(commandArgs, context);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`brain ${name}: ${error.message}`);
      io.err(command.usage);
      return EXIT.usage;
    }
    throw error;
  }

  if (args.flags.has('dry-run')) {
    io.out(JSON.stringify(request, null, 2));
    return EXIT.ok;
  }

  const connection = (deps.connect ?? connect)(env);
  if (!connection.ok) {
    io.err(connection.message);
    return EXIT.unreachable;
  }

  const response = await connection.connection.client.call(request);
  return report(response, { io, json, connection: connection.connection });
}

function report(
  response: BrainResponse,
  context: { io: CliIo; json: boolean; connection: Connection }
): number {
  const { io, json } = context;
  if (!response.ok) {
    if (json) {
      io.out(JSON.stringify(response, null, 2));
    } else {
      io.err(`brain: ${response.error.code}: ${response.error.message}`);
    }
    return EXIT.failed;
  }
  // Results are the endpoint's shapes, and the host ops' shapes are the app's.
  // Printing them verbatim keeps the CLI from drifting from either.
  io.out(render(response.result, json));
  return EXIT.ok;
}

function render(result: unknown, json: boolean): string {
  if (json) return JSON.stringify(result ?? null, null, 2);
  if (result === undefined || result === null) return 'ok';
  if (typeof result === 'string') return result;
  if (Array.isArray(result) && result.length === 0) return '(nothing)';
  return JSON.stringify(result, null, 2);
}

function helpText(): string {
  const width = Math.max(...commandNames().map((name) => name.length));
  const rows = commandNames().map((name) => `  ${name.padEnd(width)}  ${COMMANDS[name]!.summary}`);
  return [
    'brain - drive a running Ninebrains Brain from the shell.',
    '',
    'Usage: brain <command> [arguments] [--project ID] [--json] [--dry-run]',
    '       brain                   launch interactive TUI',
    '',
    'Commands:',
    ...rows,
    '',
    'Global flags:',
    '  --project ID  the project to act in; defaults to NINEBRAINS_PROJECT',
    '  --json        print the raw result, for scripts',
    '  --dry-run     print the request that would be sent, and send nothing',
    '  --help        this text',
    '',
    'Environment:',
    '  NINEBRAINS_PROJECT           default --project',
    '  NINEBRAINS_BRAIN_HANDSHAKE   path to a specific handshake file',
    '  NINEBRAINS_BRAIN_TIMEOUT_MS  request timeout, default 30000',
    '',
    "Run `brain <command> --help` for one command's usage.",
  ].join('\n');
}

/** `brain <command> --help` prints just that command's usage. */
export function usageFor(name: string): string | undefined {
  return COMMANDS[name]?.usage;
}

// `-p` mode: run the script once, emit text / json / stream-json, exit.
import { assistantEvent, initEvent, rateLimitEvent, resultEvent, toolResultEvent } from './events.mjs';
import { runSteps } from './steps.mjs';

async function readStdin(stdin) {
  if (stdin.isTTY) return '';
  let data = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) data += chunk;
  return data;
}

export async function runPrintMode(opts, { steps, io, env, openSession }) {
  const { stdout, stderr } = io;
  if (opts.outputFormat === 'stream-json' && !opts.verbose) {
    stderr.write('Error: When using --print, --output-format=stream-json requires --verbose\n');
    return 1;
  }
  const prompt = opts.prompt ?? (await readStdin(io.stdin)).trim();
  if (!prompt) {
    stderr.write('Error: Input must be provided either through stdin or as a prompt argument when using --print\n');
    return 1;
  }

  const ctx = await openSession();
  ctx.state.prompt = prompt;
  const stream = opts.outputFormat === 'stream-json';
  const emit = (event) => stream && stdout.write(JSON.stringify(event) + '\n');

  emit(initEvent({ ...ctx, mcpServers: ctx.mcpServers, permissionMode: opts.permissionMode }));
  if (env.FAKE_AGENT_RATE_LIMIT) emit(rateLimitEvent(ctx.sessionId, JSON.parse(env.FAKE_AGENT_RATE_LIMIT)));
  ctx.hooks.fire('SessionStart', { source: typeof opts.resume === 'string' ? 'resume' : 'startup', model: ctx.model });
  ctx.hooks.fire('UserPromptSubmit', { prompt });

  const ui = {
    text: (text) => emit(assistantEvent(ctx.sessionId, ctx.model, { type: 'text', text })),
    toolUse: (block) => emit(assistantEvent(ctx.sessionId, ctx.model, block)),
    toolResult: (id, content, isError, raw) => emit(toolResultEvent(ctx.sessionId, id, content, isError, raw)),
    // Nobody can answer a prompt in -p mode, so anything not pre-approved is denied.
    askPermission: async () => false,
  };

  let outcome;
  let fatal;
  try {
    outcome = await runSteps(ctx, steps ?? [{ say: prompt }], ui);
  } catch (err) {
    fatal = err;
    outcome = { exitCode: 1 };
  }
  ctx.hooks.fire('Stop', { stop_hook_active: false });

  const subtype = outcome.maxTurns ? 'error_max_turns' : fatal ? 'error_during_execution' : 'success';
  const errors = outcome.maxTurns
    ? [`Reached maximum number of turns (${opts.maxTurns})`]
    : fatal
      ? [fatal.message]
      : undefined;
  const result = resultEvent({
    sessionId: ctx.sessionId,
    subtype,
    result: ctx.state.lastText,
    errors,
    numTurns: ctx.state.turns + 1,
    startedAt: ctx.startedAt,
    denials: ctx.state.denials,
    terminalReason: outcome.maxTurns ? 'max_turns' : undefined,
    stopReason: outcome.maxTurns ? 'tool_use' : undefined,
  });
  if (stream) emit(result);
  else if (opts.outputFormat === 'json') stdout.write(JSON.stringify(result) + '\n');
  else if (errors) stderr.write(`Error: ${errors.join('; ')}\n`); // text-mode error wording not verified against real claude
  else stdout.write(result.result + '\n');

  ctx.hooks.fire('SessionEnd', { reason: 'other' });
  await ctx.close();
  if (outcome.exitCode !== undefined) return outcome.exitCode;
  return subtype === 'success' ? 0 : 1;
}

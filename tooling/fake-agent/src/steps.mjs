// Executes a scripted run. A script is a JSON array of steps (or {steps: [...]}):
//   { "say": "text" }                         assistant text; {{prompt}} and {{lastToolResult}} interpolate
//   { "callTool": { "server", "tool", "args" } }  real MCP call via --mcp-config
//   { "writeFile": { "path", "content" } }    emits a Write tool_use and writes the file under cwd
//   { "bash": "command" }                     emits a Bash tool_use and runs it with /bin/sh in cwd
//   { "sleep": ms }
//   { "waitForInput": true }                  interactive only: end this turn, wait for the next line
//   { "exit": code }                          end the run with this exit code
// The `ui` object decides how each step is rendered (stream-json vs. terminal).
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function loadScript(value) {
  if (!value) return null;
  const text = /^\s*[[{]/.test(value) ? value : readFileSync(value, 'utf8');
  const parsed = JSON.parse(text);
  const steps = Array.isArray(parsed) ? parsed : parsed.steps;
  if (!Array.isArray(steps)) throw new Error('FAKE_AGENT_SCRIPT must be an array of steps or {"steps": [...]}');
  return steps;
}

const interpolate = (text, ctx) =>
  String(text)
    .replaceAll('{{prompt}}', ctx.state.prompt ?? '')
    .replaceAll('{{lastToolResult}}', ctx.state.lastToolResult ?? '');

function toolMatches(list, name) {
  return list.some((entry) => {
    if (entry === name) return true;
    if (entry.endsWith('__*')) return name.startsWith(entry.slice(0, -1));
    // "mcp__server" allows every tool on that server.
    return entry.startsWith('mcp__') && entry.split('__').length === 2 && name.startsWith(entry + '__');
  });
}

function isAllowed(ctx, name) {
  const { permissionMode, allowedTools } = ctx.opts;
  if (permissionMode === 'bypassPermissions') return true;
  if (name === 'Write' && permissionMode === 'acceptEdits') return true;
  return toolMatches(allowedTools, name);
}

const textOf = (content) =>
  Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : String(content ?? '');

async function runTool(ctx, ui, name, input, execute) {
  if (ctx.opts.maxTurns && ctx.state.turns >= ctx.opts.maxTurns) return { maxTurns: true };
  ctx.state.turns++;
  const id = `toolu_fake_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  ui.toolUse({ type: 'tool_use', id, name, input });

  if (toolMatches(ctx.opts.disallowedTools, name)) {
    ui.toolResult(id, `<tool_use_error>Error: No such tool available: ${name}</tool_use_error>`, true);
    return {};
  }
  if (!isAllowed(ctx, name) && !(await ui.askPermission(name, input, id))) {
    ctx.state.denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
    ui.toolResult(id, `Claude requested permissions to use ${name}, but you haven't granted it yet.`, true);
    return {};
  }
  const pre = ctx.hooks.fire('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id });
  if (pre.blocked) {
    ui.toolResult(id, pre.reason, true);
    return {};
  }
  let content;
  let isError = false;
  let raw;
  try {
    ({ content, isError = false, raw } = await execute());
  } catch (err) {
    content = `<tool_use_error>Error: ${err.message}</tool_use_error>`;
    isError = true;
  }
  ctx.state.lastToolResult = textOf(content);
  ui.toolResult(id, content, isError, raw);
  ctx.hooks.fire('PostToolUse', { tool_name: name, tool_input: input, tool_use_id: id, tool_response: raw ?? content });
  return {};
}

async function callMcp(ctx, { server, tool, args = {} }) {
  const client = ctx.mcp.get(server);
  if (!client) throw new Error(`No MCP server named '${server}' in --mcp-config`);
  if (!(await client.hasTool(tool))) throw new Error(`No such tool available: mcp__${server}__${tool}`);
  const res = await client.callTool(tool, args);
  return { content: res.content ?? [], isError: Boolean(res.isError), raw: res.content ?? [] };
}

function writeFileStep(ctx, { path, content = '' }) {
  const target = isAbsolute(path) ? path : resolve(ctx.cwd, path);
  const existed = existsSync(target);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  const msg = existed ? `The file ${target} has been updated.` : `File created successfully at: ${target}`;
  return { content: msg, raw: { type: existed ? 'update' : 'create', filePath: target, content } };
}

// Real claude would run this inside its sandbox; the fake has none, so tests
// that script `bash` must rely on the tool being denied, not on isolation.
function bashStep(ctx, command) {
  const r = spawnSync('/bin/sh', ['-c', command], { cwd: ctx.cwd, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { content: output, isError: r.status !== 0, raw: { stdout: r.stdout, stderr: r.stderr } };
}

/**
 * Runs steps from `start`. Returns { next, exitCode?, maxTurns?, waitForInput? }
 * where `next` is the index to resume from after waitForInput.
 */
export async function runSteps(ctx, steps, ui, start = 0) {
  for (let i = start; i < steps.length; i++) {
    const step = steps[i];
    if ('say' in step) {
      // Replying after a tool result is another model turn, so it counts too.
      if (ctx.opts.maxTurns && ctx.state.turns >= ctx.opts.maxTurns) return { next: i, maxTurns: true };
      const text = interpolate(step.say, ctx);
      ctx.state.lastText = text;
      ui.text(text);
    } else if (step.callTool) {
      const { server, tool, args = {} } = step.callTool;
      const r = await runTool(ctx, ui, `mcp__${server}__${tool}`, args, () => callMcp(ctx, step.callTool));
      if (r.maxTurns) return { next: i, maxTurns: true };
    } else if (step.writeFile) {
      const input = { file_path: step.writeFile.path, content: step.writeFile.content ?? '' };
      const r = await runTool(ctx, ui, 'Write', input, async () => writeFileStep(ctx, step.writeFile));
      if (r.maxTurns) return { next: i, maxTurns: true };
    } else if ('bash' in step) {
      const command = String(step.bash);
      const r = await runTool(ctx, ui, 'Bash', { command }, async () => bashStep(ctx, command));
      if (r.maxTurns) return { next: i, maxTurns: true };
    } else if ('sleep' in step) {
      await new Promise((r) => setTimeout(r, Number(step.sleep)));
    } else if (step.waitForInput) {
      return { next: i + 1, waitForInput: true };
    } else if ('exit' in step) {
      return { next: i + 1, exitCode: Number(step.exit) };
    } else {
      throw new Error(`Unknown script step: ${JSON.stringify(step)}`);
    }
  }
  return { next: steps.length };
}

#!/usr/bin/env node
// Attended-lane spike: interactive `claude` in node-pty, Brain stub injected via
// --mcp-config, lane state read from hooks (not the screen).
//
// Usage: node attended.mjs <workdir> <outdir>
// Spends real model tokens (haiku, two short turns).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import { sleep, stripAnsi, writeLaneMcpConfig, writeLaneSettings } from './lib.mjs';

const [workdir, outdir] = process.argv.slice(2);
if (!workdir || !outdir) {
  console.error('usage: node attended.mjs <workdir> <outdir>');
  process.exit(2);
}

const laneId = 'lane-B';
const files = {
  mcp: join(outdir, 'attended.mcp.json'),
  settings: join(outdir, 'attended.settings.json'),
  stubLog: join(outdir, 'attended.stub.log'),
  hookLog: join(outdir, 'attended.hooks.log'),
  statusLog: join(outdir, 'attended.status.log'),
  raw: join(outdir, 'attended.pty.raw'),
  timeline: join(outdir, 'attended.timeline.log'),
};
for (const f of [files.stubLog, files.hookLog, files.statusLog, files.raw, files.timeline]) writeFileSync(f, '');

writeLaneMcpConfig(files.mcp, { laneId, stubLog: files.stubLog });
writeLaneSettings(files.settings);
const sessionId = randomUUID();

const t0 = Date.now();
const mark = (msg) => {
  const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`;
  appendFileSync(files.timeline, line + '\n');
  console.log(line);
};

// Only claim_task and late_tool are pre-approved, so calling ping must raise a
// permission prompt. That is how we observe "waiting on user" via hooks.
const args = [
  '--model', 'haiku',
  '--mcp-config', files.mcp,
  '--strict-mcp-config',
  '--settings', files.settings,
  '--setting-sources', 'project,local',
  '--session-id', sessionId,
  '--no-chrome', // otherwise a "Claude in Chrome extension detected" dialog can block startup
  '--allowedTools', 'mcp__stub__claim_task', 'mcp__stub__late_tool',
];
mark(`spawn claude ${args.join(' ')}`);

// A parent Claude Code session leaks markers (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION,
// ...) that make the child turn transcript saving off. Scrub them.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^CLAUDECODE$|^CLAUDE_CODE_|^CLAUDE_PID$/.test(k))
);

const term = pty.spawn('claude', args, {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: workdir,
  env: {
    ...env,
    LANE_ID: laneId,
    HOOK_LOG: files.hookLog,
    STATUS_LOG: files.statusLog,
    ENABLE_TOOL_SEARCH: 'false',
  },
});

let screen = '';
let lastOutputAt = Date.now();
term.onData((d) => {
  appendFileSync(files.raw, d);
  screen += d;
  lastOutputAt = Date.now();
});
let exited = null;
term.onExit((e) => {
  exited = e;
  mark(`exit ${JSON.stringify(e)}`);
});

const hookEvents = () =>
  existsSync(files.hookLog)
    ? readFileSync(files.hookLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
const stubCalls = () =>
  readFileSync(files.stubLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function waitFor(label, pred, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exited) throw new Error(`claude exited while waiting for ${label}`);
    if (pred()) {
      mark(`ok: ${label}`);
      return true;
    }
    await sleep(200);
  }
  mark(`TIMEOUT: ${label}`);
  return false;
}
const quiet = (ms) => () => Date.now() - lastOutputAt > ms;
const countHooks = (name, extra = () => true) => hookEvents().filter((e) => e.hook_event_name === name && extra(e)).length;

// Bracketed paste keeps multi-line text as one prompt; the submit key is a
// separate write so the TUI sees it as Enter rather than a pasted newline.
async function submit(text) {
  term.write(`\x1b[200~${text}\x1b[201~`);
  await sleep(300);
  term.write('\r');
  mark(`submitted: ${JSON.stringify(text)}`);
}

try {
  // 1. Startup. First-run dialogs (workspace trust, Chrome extension, ...) block
  //    the input box, and SessionStart only fires once they are gone. So: clear
  //    dialogs until SessionStart arrives, and never type a prompt before that.
  await waitFor('first render', () => screen.length > 0, 30_000);
  let seen = 0;
  const deadline = Date.now() + 60_000;
  while (countHooks('SessionStart') < 1 && Date.now() < deadline && !exited) {
    await waitFor('screen settles', quiet(1500), 15_000);
    const fresh = stripAnsi(screen.slice(seen)).replace(/\s+/g, '');
    seen = screen.length;
    if (/trustthisfolder/i.test(fresh)) {
      // DEFAULT option is "No, exit": a bare Enter quits claude with exit 1
      // (first attempt). Move down to "Yes" first. Ninebrains should pre-trust
      // the worktree instead, as Emdash's trust.ts does.
      mark('trust dialog: Down, then Enter');
      term.write('\x1b[B');
      await sleep(300);
      term.write('\r');
    } else if (/Entertoconfirm/i.test(fresh)) {
      mark(`unknown dialog, taking its default: ${fresh.slice(0, 120)}`);
      term.write('\r');
    }
    await sleep(500);
  }
  await waitFor('SessionStart hook', () => countHooks('SessionStart') >= 1, 5_000);
  await waitFor('input box idle', quiet(1500), 30_000);

  // 2. Turn 1: ping (not pre-approved) -> permission prompt -> approve -> Stop.
  await submit('Call the ping tool from the stub MCP server once, then reply with only the text it returned.');
  await waitFor('UserPromptSubmit hook', () => countHooks('UserPromptSubmit') >= 1, 20_000);
  const gotPermission = await waitFor(
    'PermissionRequest or Notification(permission) hook',
    () => countHooks('PermissionRequest') >= 1 || countHooks('Notification') >= 1,
    90_000
  );
  if (gotPermission) {
    await waitFor('permission dialog painted', quiet(800), 10_000);
    mark('approving permission prompt with Enter (default = Yes)');
    term.write('\r');
  }
  await waitFor('Stop hook after turn 1', () => countHooks('Stop') >= 1, 90_000);
  mark(`stub calls after turn 1: ${JSON.stringify(stubCalls().map((c) => c.tool))}`);

  // 3. Hot-load probe A: edit the --mcp-config file mid-session to add a second
  //    server, then open /mcp and look for it. /mcp is local, no model tokens.
  const cfg = JSON.parse(readFileSync(files.mcp, 'utf8'));
  cfg.mcpServers.stub2 = { ...cfg.mcpServers.stub, env: { ...cfg.mcpServers.stub.env, LANE_ID: 'lane-B2' } };
  writeFileSync(files.mcp, JSON.stringify(cfg, null, 2));
  mark('added stub2 to the --mcp-config file on disk');
  await sleep(1000);
  const before = screen.length;
  term.write('/mcp');
  await sleep(400);
  term.write('\r');
  await waitFor('/mcp panel settles', quiet(1500), 15_000);
  const mcpPanel = stripAnsi(screen.slice(before));
  writeFileSync(join(outdir, 'attended.mcp-panel.txt'), mcpPanel);
  mark(`/mcp panel lists stub2: ${/stub2/.test(mcpPanel)}; lists stub: ${/\bstub\b/.test(mcpPanel)}`);
  term.write('\x1b'); // close the panel
  await sleep(800);
  term.write('\x1b');
  await waitFor('panel closed', quiet(1000), 10_000);

  // 4. Hot-load probe B: claim_task makes the stub register late_tool at runtime
  //    (tools/list_changed). Ask for both in one turn.
  const stopsBefore = countHooks('Stop');
  await submit(
    'Call the stub claim_task tool with taskId "T-1". Calling it unlocks a new tool named late_tool on the same server. ' +
      'After claim_task returns, call late_tool and reply with only its output.'
  );
  await waitFor('Stop hook after turn 2', () => countHooks('Stop') > stopsBefore, 120_000);
  mark(`stub calls after turn 2: ${JSON.stringify(stubCalls().map((c) => c.tool))}`);

  // 5. Idle detection check: no Notification(idle) expected this fast; record what we saw.
  await sleep(2000);
} catch (err) {
  mark(`error: ${err.message}`);
} finally {
  if (!exited) {
    term.write('/exit');
    await sleep(300);
    term.write('\r');
    await sleep(3000);
    if (!exited) term.kill();
  }
  const summary = {
    sessionId,
    stubCalls: stubCalls(),
    hookSequence: hookEvents().map((e) => ({
      t: +((e.receivedAt - t0) / 1000).toFixed(1),
      event: e.hook_event_name,
      tool: e.tool_name,
      notification_type: e.notification_type,
      message: e.message,
    })),
    statusLines: readFileSync(files.statusLog, 'utf8').trim().split('\n').filter(Boolean).length,
  };
  writeFileSync(join(outdir, 'attended.summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

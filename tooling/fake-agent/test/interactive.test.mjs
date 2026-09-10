import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BIN, EXEC_PATHS, echoMcpConfig, hookSettings, interact, readJsonLines, tempDir } from './helpers.mjs';

test('interactive: banner, echoed lines, script split by waitForInput, /exit', async () => {
  const steps = [
    { say: 'hi {{prompt}}' },
    { waitForInput: true },
    { callTool: { server: 'echo', tool: 'echo', args: { text: 'pong' } } },
    { say: 'done' },
  ];
  const s = interact(['--mcp-config', echoMcpConfig(), '--allowedTools', 'mcp__echo'], {
    env: { FAKE_AGENT_SCRIPT: JSON.stringify(steps), LANE_ID: 'lane-I' },
  });
  await s.waitFor('> ');
  assert.match(s.output, /Fake Claude Code \(fake-agent\) \| lane lane-I/);
  assert.match(s.output, /mcp: echo \(connected\)/);
  s.write('first\n');
  await s.waitFor('● hi first');
  s.write('second\n');
  await s.waitFor('● done');
  assert.match(s.output, /you said: second/);
  assert.match(s.output, /mcp__echo__echo/);
  assert.match(s.output, /⎿ pong/);
  s.write('/exit\n');
  assert.equal(await s.closed, 0);
});

test('interactive: bracketed paste keeps newlines, \\r submits', async () => {
  const s = interact([]);
  await s.waitFor('> ');
  s.write('\x1b[200~line one\nline two\x1b[201~\r');
  await s.waitFor('you said: line one\nline two');
  s.write('/exit\r');
  assert.equal(await s.closed, 0);
});

test('interactive: unapproved tool raises a permission prompt with hooks; "1" approves', async () => {
  const hookLog = join(tempDir(), 'hooks.log');
  const s = interact(['--mcp-config', echoMcpConfig(), '--settings', hookSettings()], {
    env: { FAKE_AGENT_SCRIPT: JSON.stringify([{ callTool: { server: 'echo', tool: 'whoami' } }]), HOOK_LOG: hookLog, LANE_ID: 'lane-P' },
  });
  await s.waitFor('> ');
  s.write('go\n');
  await s.waitFor('Do you want to proceed?');
  const waiting = readJsonLines(hookLog).map((h) => h.hook_event_name);
  assert.ok(waiting.includes('PermissionRequest'));
  assert.equal(readJsonLines(hookLog).find((h) => h.hook_event_name === 'Notification').notification_type, 'permission_prompt');
  s.write('1\n');
  await s.waitFor('⎿ lane-P');
  await s.waitFor(/> $/);
  assert.equal(readJsonLines(hookLog).at(-1).hook_event_name, 'Stop');
  s.write('/exit\n');
  assert.equal(await s.closed, 0);
});

test('interactive: exit step ends the session with its code', async () => {
  const s = interact([], { env: { FAKE_AGENT_SCRIPT: JSON.stringify([{ say: 'bye' }, { exit: 4 }]) } });
  await s.waitFor('> ');
  s.write('x\n');
  assert.equal(await s.closed, 4);
});

const ptyPath = join(EXEC_PATHS, 'node_modules/node-pty');
test('interactive: works inside a real PTY with the claude input recipe', { skip: !existsSync(ptyPath) && 'run npm install in spikes/exec-paths' }, async () => {
  const pty = createRequire(join(EXEC_PATHS, 'package.json'))('node-pty');
  const term = pty.spawn(process.execPath, [BIN], { name: 'xterm-256color', cols: 100, rows: 30, cwd: tempDir(), env: process.env });
  let out = '';
  term.onData((d) => (out += d));
  const exited = new Promise((resolve) => term.onExit(resolve));
  const waitFor = async (needle) => {
    for (let i = 0; i < 250 && !out.includes(needle); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(out.includes(needle), `missing ${JSON.stringify(needle)} in ${JSON.stringify(out)}`);
  };
  await waitFor('> ');
  term.write('\x1b[200~hello from pty\x1b[201~');
  term.write('\r');
  await waitFor('you said: hello from pty');
  term.write('/exit\r');
  assert.equal((await exited).exitCode, 0);
});

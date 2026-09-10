#!/usr/bin/env node
// Zero-token probe of the variadic --mcp-config vs positional-prompt trap.
// Runs real `claude` with CLAUDE_CONFIG_DIR pointed at an empty temp dir, so
// every run stops at "Not logged in" before any model request. The stream-json
// init event (or the error text) shows whether the prompt survived and which
// MCP servers loaded. The temp dir is deleted at the end. Never logs in (D5).
//
// Usage: node variadic-probe.mjs <workdir>
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pty from 'node-pty';
import { STUB_SERVER, sleep, stripAnsi } from './lib.mjs';

const workdir = process.argv[2] ?? process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'variadic-probe-'));
const emptyConfigDir = join(scratch, 'empty-claude-config');
const a = join(scratch, 'a.json');
const b = join(scratch, 'b.json');
const server = (lane) => ({ type: 'stdio', command: process.execPath, args: [STUB_SERVER], env: { LANE_ID: lane } });
writeFileSync(a, JSON.stringify({ mcpServers: { stub: server('lane-V') } }));
writeFileSync(b, JSON.stringify({ mcpServers: { stub2: server('lane-V2') } }));

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^CLAUDECODE$|^CLAUDE_CODE_|^CLAUDE_PID$|^ANTHROPIC_/.test(k))
);
env.CLAUDE_CONFIG_DIR = emptyConfigDir;
const SJ = ['--output-format', 'stream-json', '--verbose', '--model', 'haiku'];
const P = 'say hi';

const printCases = [
  ['swallowed: -p --mcp-config a PROMPT', ['-p', ...SJ, '--mcp-config', a, P]],
  ['equals: -p --mcp-config=a PROMPT', ['-p', ...SJ, `--mcp-config=${a}`, P]],
  ['prompt first: -p PROMPT --mcp-config a', ['-p', P, ...SJ, '--mcp-config', a]],
  ['separator: -p --mcp-config a -- PROMPT', ['-p', ...SJ, '--mcp-config', a, '--', P]],
  ['stdin: -p --mcp-config a  <<< PROMPT', ['-p', ...SJ, '--mcp-config', a], P],
  ['two configs, space form', ['-p', P, ...SJ, '--mcp-config', a, b]],
  ['two configs, repeated equals', ['-p', P, ...SJ, `--mcp-config=${a}`, `--mcp-config=${b}`]],
  ['inline JSON config', ['-p', P, ...SJ, '--mcp-config', readFileSync(a, 'utf8')]],
];

function summarize(stdout, stderr) {
  const lines = stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const init = lines.find((e) => e.subtype === 'init');
  const result = lines.find((e) => e.type === 'result');
  return {
    promptAccepted: Boolean(init),
    mcpServers: init?.mcp_servers?.map((s) => `${s.name}:${s.status}`) ?? [],
    result: result && { subtype: result.subtype, is_error: result.is_error, terminal_reason: result.terminal_reason, text: result.result },
    stderr: stderr.trim().split('\n').slice(0, 2).join(' | '),
  };
}

try {
  for (const [label, args, stdin] of printCases) {
    const r = spawnSync('claude', args, { cwd: workdir, env, input: stdin ?? '', encoding: 'utf8', timeout: 60_000 });
    console.log(JSON.stringify({ label, exit: r.status, ...summarize(r.stdout, r.stderr) }));
  }

  // Attended form: interactive TUI in a PTY, killed after 8 s.
  for (const [label, args] of [
    ['interactive swallowed: --mcp-config a PROMPT', ['--mcp-config', a, P]],
    ['interactive equals: --mcp-config=a PROMPT', [`--mcp-config=${a}`, P]],
  ]) {
    const term = pty.spawn('claude', args, { name: 'xterm-256color', cols: 120, rows: 30, cwd: workdir, env });
    let out = '';
    let exit = null;
    term.onData((d) => (out += d));
    term.onExit((e) => (exit = e));
    await sleep(8000);
    if (!exit) term.kill();
    const screen = stripAnsi(out).replace(/\s+/g, ' ').trim();
    console.log(
      JSON.stringify({
        label,
        exitedWithin8s: exit ? exit.exitCode : false,
        mcpConfigError: /MCP config file not found/.test(screen),
        screen: screen.slice(0, 200),
      })
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  console.log(`deleted ${scratch}`);
}

#!/usr/bin/env node
// Unattended-lane spike: `claude -p --output-format stream-json` with the stub
// Brain injected via --mcp-config. Parses the stream and checks that the MCP
// tool_use / tool_result pair appeared and the stub really logged the call.
//
// Usage: node unattended.mjs <workdir> <outdir>
// Real claude spends tokens (haiku, one short run). Set CLAUDE_BIN to the fake
// agent (../../tooling/fake-agent/bin/fake-claude.mjs) plus FAKE_AGENT_SCRIPT to run free.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeLaneMcpConfig } from './lib.mjs';

const [workdir, outdir] = process.argv.slice(2);
if (!workdir || !outdir) {
  console.error('usage: node unattended.mjs <workdir> <outdir>');
  process.exit(2);
}

const laneId = 'lane-U';
const mcpPath = join(outdir, 'unattended.mcp.json');
const stubLog = join(outdir, 'unattended.stub.log');
writeFileSync(stubLog, '');
writeLaneMcpConfig(mcpPath, { laneId, stubLog });

const bin = process.env.CLAUDE_BIN ?? 'claude';
// Variadic flags (--mcp-config, --allowedTools) swallow any positional that
// follows them, so they use the --flag=value form and the prompt sits right
// after -p. See docs/SPIKE-EXEC-PATHS.md §3.1.
const args = [
  '-p', 'Call the ping tool on the stub MCP server, then reply with exactly the text it returned.',
  '--output-format', 'stream-json', '--verbose',
  '--model', 'haiku',
  `--mcp-config=${mcpPath}`, '--strict-mcp-config',
  '--allowedTools=mcp__stub__ping',
  '--permission-mode', 'dontAsk',
  '--setting-sources', 'project,local',
  '--max-turns', '4',
  '--session-id', randomUUID(),
  '--append-system-prompt', `You are working in lane ${laneId}.`,
];
const [cmd, ...pre] = bin.endsWith('.mjs') ? [process.execPath, bin] : [bin];

const child = spawn(cmd, [...pre, ...args], {
  cwd: workdir,
  env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' },
  stdio: ['ignore', 'pipe', 'inherit'], // closed stdin avoids the 3s "no stdin data" wait
});

const events = [];
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) events.push(JSON.parse(line));
  }
});

const code = await new Promise((resolve) => child.on('close', resolve));
writeFileSync(join(outdir, 'unattended.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');

const blocks = events.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []));
const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'mcp__stub__ping');
const toolResult = toolUse && blocks.find((b) => b.type === 'tool_result' && b.tool_use_id === toolUse.id);
const result = events.find((e) => e.type === 'result');
const stubCalls = readFileSync(stubLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const report = {
  exitCode: code,
  init: events[0]?.subtype === 'init' ? { mcp_servers: events[0].mcp_servers, session_id: events[0].session_id } : null,
  toolUse: Boolean(toolUse),
  toolResult: toolResult?.content ?? null,
  result: result && { subtype: result.subtype, result: result.result, num_turns: result.num_turns, cost: result.total_cost_usd },
  rateLimit: events.find((e) => e.type === 'rate_limit_event')?.rate_limit_info?.unifiedWindows ?? null,
  stubCalls: stubCalls.map((c) => `${c.tool}@${c.laneId}`),
};
console.log(JSON.stringify(report, null, 2));
const ok = report.toolUse && report.toolResult && stubCalls.some((c) => c.tool === 'ping' && c.laneId === laneId);
process.exit(ok ? 0 : 1);

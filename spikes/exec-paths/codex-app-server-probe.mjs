#!/usr/bin/env node
// Codex app-server probe that needs no login: speaks JSON-RPC over stdio,
// starts a thread with a per-thread mcp_servers config, then asks for MCP
// server status and rate limits. Run with CODEX_HOME pointed at an empty dir.
//
// Usage: CODEX_HOME=<empty dir> node codex-app-server-probe.mjs <workdir>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { STUB_SERVER } from './lib.mjs';

const workdir = process.argv[2] ?? process.cwd();
const child = spawn('npx', ['-y', '@openai/codex@latest', 'app-server'], {
  cwd: workdir,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
const pending = new Map();
const notifications = [];
createInterface({ input: child.stdout }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    notifications.push(msg.method + (msg.params?.name ? `(${msg.params.name}:${msg.params.status})` : ''));
  }
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => pending.has(id) && (pending.delete(id), resolve({ timeout: true })), 20_000);
  });
}
const show = (label, res) => console.log(`## ${label}\n${JSON.stringify(res.result ?? res.error ?? res, null, 2).slice(0, 1500)}`);

show('initialize', await request('initialize', { clientInfo: { name: 'ninebrains-spike', version: '0.0.1' } }));
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');

const thread = await request('thread/start', {
  cwd: workdir,
  ephemeral: true,
  config: {
    'mcp_servers.stub.command': process.execPath,
    'mcp_servers.stub.args': [STUB_SERVER],
    'mcp_servers.stub.env': { LANE_ID: 'lane-C' },
  },
});
show('thread/start', thread);
const threadId = thread.result?.thread?.id;

await new Promise((r) => setTimeout(r, 4000));
show('mcpServerStatus/list', await request('mcpServerStatus/list', { threadId }));
show('account/read', await request('account/read', {}));
show('account/rateLimits/read', await request('account/rateLimits/read', {}));
console.log('## notifications seen\n' + notifications.join('\n'));
child.kill();
process.exit(0);

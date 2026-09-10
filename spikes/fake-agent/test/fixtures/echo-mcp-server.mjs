#!/usr/bin/env node
// Zero-dependency stdio MCP server for fake-agent tests.
// Tools: echo(text), whoami() -> $LANE_ID, fail() -> isError, grow() -> adds
// `extra` and sends notifications/tools/list_changed.
import { appendFileSync } from 'node:fs';

const tools = [
  { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'whoami', description: 'Lane id', inputSchema: { type: 'object', properties: {} } },
  { name: 'fail', description: 'Always errors', inputSchema: { type: 'object', properties: {} } },
  { name: 'grow', description: 'Adds the extra tool', inputSchema: { type: 'object', properties: {} } },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

function call(name, args) {
  if (process.env.ECHO_LOG) appendFileSync(process.env.ECHO_LOG, JSON.stringify({ name, args }) + '\n');
  switch (name) {
    case 'echo':
      return text(String(args.text ?? ''));
    case 'whoami':
      return text(process.env.LANE_ID ?? 'unset');
    case 'fail':
      return text('boom', true);
    case 'grow':
      if (!tools.some((t) => t.name === 'extra')) {
        tools.push({ name: 'extra', description: 'Added at runtime', inputSchema: { type: 'object', properties: {} } });
        send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      }
      return text('grown');
    case 'extra':
      return text('extra-ok');
    default:
      return null;
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue; // notification
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: msg.params.protocolVersion,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'echo', version: '0.0.0' },
        },
      });
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
    } else if (msg.method === 'tools/call') {
      const result = call(msg.params.name, msg.params.arguments ?? {});
      if (result) send({ jsonrpc: '2.0', id: msg.id, result });
      else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool: ${msg.params.name}` } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
  }
});

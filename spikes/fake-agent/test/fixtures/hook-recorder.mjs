#!/usr/bin/env node
// Test hook: appends the payload to $HOOK_LOG. If $BLOCK_TOOL names the tool of a
// PreToolUse event, exits 2 (Claude Code's "block this tool call" signal).
import { appendFileSync } from 'node:fs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  if (process.env.HOOK_LOG) appendFileSync(process.env.HOOK_LOG, JSON.stringify(payload) + '\n');
  if (payload.hook_event_name === 'PreToolUse' && process.env.BLOCK_TOOL === payload.tool_name) {
    process.stderr.write('blocked by gate');
    process.exit(2);
  }
});

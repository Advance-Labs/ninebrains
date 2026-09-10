#!/usr/bin/env node
// Claude Code hook command. Appends {receivedAt, event payload} to $HOOK_LOG.
// Registered for every lane-state event in lane-settings.json. Always exits 0
// so it never blocks or alters the agent.
import { appendFileSync } from 'node:fs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  const logPath = process.env.HOOK_LOG;
  if (!logPath) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { unparsed: raw };
  }
  appendFileSync(logPath, JSON.stringify({ receivedAt: Date.now(), laneId: process.env.LANE_ID, ...payload }) + '\n');
});

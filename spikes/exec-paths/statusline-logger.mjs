#!/usr/bin/env node
// Claude Code statusLine command. Appends the stdin JSON to $STATUS_LOG and
// prints a one-line status. This is the credential-free usage-meter source:
// the payload carries rate_limits.{five_hour,seven_day}.used_percentage.
import { appendFileSync } from 'node:fs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {}
  if (process.env.STATUS_LOG) {
    appendFileSync(process.env.STATUS_LOG, JSON.stringify({ receivedAt: Date.now(), ...data }) + '\n');
  }
  const fiveH = data.rate_limits?.five_hour?.used_percentage;
  process.stdout.write(`lane ${process.env.LANE_ID ?? '?'}${fiveH != null ? ` | 5h ${Math.round(fiveH)}%` : ''}\n`);
});

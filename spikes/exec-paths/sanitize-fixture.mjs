#!/usr/bin/env node
// Copies a captured stream-json run into a committed fixture, replacing local
// paths and account-identifying values with stable placeholders.
//
// Usage: node sanitize-fixture.mjs <in.jsonl> <out.jsonl> [<workdir>]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const [input, output, workdir] = process.argv.slice(2);
let text = readFileSync(input, 'utf8');
const swaps = [];
if (workdir) swaps.push([workdir, '<WORKDIR>']);
swaps.push([homedir(), '<HOME>']);
for (const [from, to] of swaps) text = text.split(from).join(to);
text = text.replace(/\/private\/tmp\/claude-\d+\/[^"\s]*/g, '<TMP>');

const DROP_KEYS = new Set(['memory_paths', 'messaging_socket_path', 'request_id']);
const lines = text
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line, (key, value) => (DROP_KEYS.has(key) ? undefined : value)));
writeFileSync(output, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
console.log(`wrote ${lines.length} events to ${output}`);

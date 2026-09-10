#!/usr/bin/env node
// Fallback stand-in for `claude` when the fake-agent package is absent: answers
// `--version`, prints a banner, then echoes each submitted line.
if (process.argv.includes('--version')) {
  process.stdout.write('0.0.0 (Stub Claude Code)\n');
  process.exit(0);
}
process.stdout.write('Stub Claude Code ready\r\n> ');
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
  process.stdout.write(chunk.replace(/\r/g, '\r\n'));
  if (chunk.includes('')) process.exit(0);
});

/**
 * Claude Code PreToolUse hook (.claude/settings.json). Denies a Bash call that runs heavy work
 * (install, typecheck, tests, builds) outside a gate slot and hands the agent the gated command.
 *
 * Why: on 2026-11-12 one task fanned out 7 subagents, each in its own worktree running pnpm
 * install, tsgo, vitest and nx build at once. The pre-push gate (#161) never saw that work, swap
 * reached ~28 GB, and macOS killed Ninebrains with every task in it.
 *
 * Deny, not rewrite: other hooks (rtk) also rewrite Bash input, and with two rewrites neither is
 * guaranteed to win. A deny always applies.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ponytail: a word-level look at what each shell segment runs, not a shell parser. Heavy work
// behind an unfamiliar script or tool name slips through; add the name here when one shows up.
const HEAVY_TOOLS = new Set(['tsgo', 'tsc', 'vitest']);
const HEAVY_SCRIPTS = new Set(['typecheck', 'test', 'build', 'check', 'install', 'i']);
const HEAVY_NX = new Set(['affected', 'run-many', 'build', 'test', 'typecheck']);
const TOOL_PAIRS = { playwright: 'test', next: 'build', 'electron-vite': 'build' };
const PM = new Set(['pnpm', 'npm', 'yarn']);
const FLAGS_WITH_VALUE = new Set(['--dir', '-C', '--filter', '-F', '--prefix', '--workspace']);
const PREFIXES = new Set(['time', 'nice', 'command', 'env', 'exec']);

const isScriptHeavy = (name) => HEAVY_SCRIPTS.has(String(name).split(':')[0]);

/** The first word in `words` that is not a flag (or a flag's value), removing everything before it. */
function nextWord(words) {
  while (words.length > 0 && words[0].startsWith('-')) {
    const flag = words.shift();
    if (FLAGS_WITH_VALUE.has(flag)) words.shift();
  }
  return words.shift();
}

function segmentProblem(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  for (;;) {
    if (/^\w+=/.test(words[0] ?? '') || PREFIXES.has(words[0])) words.shift();
    else if (words[0] === 'timeout') words.splice(0, 2);
    else break;
  }
  let cmd = words.shift();
  if (cmd === 'npx' || cmd === 'bunx') cmd = nextWord(words);
  if (PM.has(cmd)) {
    const verb = nextWord(words);
    if (verb === 'exec' || verb === 'dlx') cmd = nextWord(words);
    else if (verb === 'run') return isScriptHeavy(nextWord(words)) ? segment.trim() : null;
    else if (verb === 'nx') cmd = 'nx';
    else return isScriptHeavy(verb) ? segment.trim() : null;
  }
  if (HEAVY_TOOLS.has(cmd)) return segment.trim();
  if (cmd === 'nx') {
    const verb = nextWord(words);
    if (HEAVY_NX.has(verb) || (verb === 'run' && isScriptHeavy(nextWord(words)?.split(':')[1]))) {
      return segment.trim();
    }
  }
  if (TOOL_PAIRS[cmd] && nextWord(words) === TOOL_PAIRS[cmd]) return segment.trim();
  return null;
}

/** The heavy part of a Bash command, or null when it is light or already gated. */
export function heavyCommandProblem(command) {
  if (typeof command !== 'string' || command.includes('gated.mjs')) return null;
  for (const segment of command.split(/&&|\|\||[;|&()\n]/)) {
    const problem = segmentProblem(segment);
    if (problem) return problem;
  }
  return null;
}

export function hookResponse(input, gatedPath) {
  const matched = heavyCommandProblem(input?.tool_input?.command);
  if (!matched) return null;
  const quoted = `'${input.tool_input.command.replace(/'/g, `'\\''`)}'`;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `"${matched}" is heavy work. On this 16 GB Mac it must take a host-wide gate slot so parallel ` +
        `agents take turns instead of swapping the machine. Run it as:\n` +
        `node ${gatedPath} sh -c ${quoted}\n` +
        `It waits for a free slot (it prints who holds them), then runs the command unchanged.`,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0); // Unreadable input: never block the agent over a hook bug.
  }
  const gatedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gated.mjs');
  const response = input?.tool_name === 'Bash' ? hookResponse(input, gatedPath) : null;
  if (response) process.stdout.write(JSON.stringify(response));
  process.exit(0);
}

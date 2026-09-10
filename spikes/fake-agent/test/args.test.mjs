import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArgError, parseArgs, splitToolList } from '../src/args.mjs';

test('splitToolList keeps parenthesised patterns whole', () => {
  assert.deepEqual(splitToolList('Bash(git *) Edit,Read'), ['Bash(git *)', 'Edit', 'Read']);
});

test('a prompt placed after a variadic flag is swallowed, as in the real CLI', () => {
  const eaten = parseArgs(['-p', '--allowedTools', 'mcp__stub__ping', 'hello']);
  assert.deepEqual(eaten.allowedTools, ['mcp__stub__ping', 'hello']);
  assert.equal(eaten.prompt, undefined);

  const safe = parseArgs(['-p', 'hello', '--allowedTools', 'mcp__stub__ping']);
  assert.equal(safe.prompt, 'hello');
  assert.deepEqual(safe.allowedTools, ['mcp__stub__ping']);
});

test('-- ends option parsing', () => {
  const opts = parseArgs(['-p', '--mcp-config', 'a.json', 'b.json', '--', '--not-a-flag']);
  assert.deepEqual(opts.mcpConfigs, ['a.json', 'b.json']);
  assert.equal(opts.prompt, '--not-a-flag');
});

test('repeated --mcp-config=<file> accumulates and never swallows the prompt', () => {
  const opts = parseArgs(['--mcp-config=a.json', '--mcp-config=b.json', 'say hi']);
  assert.deepEqual(opts.mcpConfigs, ['a.json', 'b.json']);
  assert.equal(opts.prompt, 'say hi');

  const swallowed = parseArgs(['--mcp-config', 'a.json', 'say hi']);
  assert.deepEqual(swallowed.mcpConfigs, ['a.json', 'say hi']);
  assert.equal(swallowed.prompt, undefined);
});

test('--flag=value and value flags', () => {
  const opts = parseArgs(['--output-format=stream-json', '--model', 'haiku', '--max-turns', '3', '--permission-mode', 'dontAsk']);
  assert.equal(opts.outputFormat, 'stream-json');
  assert.equal(opts.model, 'haiku');
  assert.equal(opts.maxTurns, 3);
  assert.equal(opts.permissionMode, 'dontAsk');
});

test('--resume takes an optional value', () => {
  assert.equal(parseArgs(['--resume', 'abc']).resume, 'abc');
  assert.equal(parseArgs(['--resume', '--verbose']).resume, true);
});

test('rejects unknown options and bad values', () => {
  assert.throws(() => parseArgs(['--nope']), ArgError);
  assert.throws(() => parseArgs(['--permission-mode', 'yolo']), ArgError);
  assert.throws(() => parseArgs(['--max-turns', '0']), ArgError);
  assert.throws(() => parseArgs(['--model']), ArgError);
});

test('--dangerously-skip-permissions maps to bypassPermissions', () => {
  assert.equal(parseArgs(['--dangerously-skip-permissions']).permissionMode, 'bypassPermissions');
});

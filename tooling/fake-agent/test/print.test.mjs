import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, readJsonLines, run, tempDir } from './helpers.mjs';

const STREAM = ['-p', '--output-format', 'stream-json', '--verbose'];

test('stream-json without --verbose fails like the real CLI', async () => {
  const r = await run(['-p', 'hi', '--output-format', 'stream-json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /requires --verbose/);
});

test('-p with no prompt and empty stdin fails', async () => {
  const r = await run(['-p']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Input must be provided/);
});

test('-p reads the prompt from stdin when no argument is given', async () => {
  const r = await run(['-p'], { input: 'from stdin\n' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'from stdin\n');
});

test('json output is a single result object', async () => {
  const r = await run(['-p', 'hello', '--output-format', 'json']);
  const result = JSON.parse(r.stdout);
  assert.equal(result.type, 'result');
  assert.equal(result.result, 'hello');
  assert.equal(result.is_error, false);
});

test('stream-json events carry the same keys as a real claude -p run', async () => {
  const real = readJsonLines(join(FIXTURES, 'claude-p-ping.jsonl'));
  const r = await run([...STREAM, 'hello'], { env: { FAKE_AGENT_SCRIPT: JSON.stringify([{ say: 'hi {{prompt}}' }]) } });
  assert.equal(r.code, 0);
  assert.deepEqual(
    r.events.map((e) => e.type + (e.subtype ? `/${e.subtype}` : '')),
    ['system/init', 'assistant', 'result/success']
  );
  const realOf = (pred) => real.find(pred);
  const pairs = [
    [r.events[0], realOf((e) => e.subtype === 'init')],
    [r.events[1], realOf((e) => e.type === 'assistant')],
    [r.events[2], realOf((e) => e.type === 'result')],
  ];
  for (const [fake, actual] of pairs) {
    const missing = Object.keys(fake).filter((k) => !(k in actual));
    assert.deepEqual(missing, [], `fake ${fake.type} has keys the real event lacks`);
  }
  for (const key of ['session_id', 'tools', 'mcp_servers', 'model', 'permissionMode', 'cwd']) assert.ok(key in r.events[0]);
  for (const key of ['num_turns', 'result', 'session_id', 'total_cost_usd', 'permission_denials', 'is_error']) assert.ok(key in r.events[2]);
  assert.equal(r.events[2].result, 'hi hello');
});

test('writeFile writes under cwd and emits a Write tool_use / tool_result pair', async () => {
  const cwd = tempDir();
  const script = [{ writeFile: { path: 'out/hello.txt', content: 'hi\n' } }, { say: 'done' }];
  const r = await run([...STREAM, 'go', '--permission-mode', 'acceptEdits'], { cwd, env: { FAKE_AGENT_SCRIPT: JSON.stringify(script) } });
  assert.equal(readFileSync(join(cwd, 'out/hello.txt'), 'utf8'), 'hi\n');
  const use = r.events.find((e) => e.message?.content?.[0]?.type === 'tool_use').message.content[0];
  assert.equal(use.name, 'Write');
  const res = r.events.find((e) => e.type === 'user').message.content[0];
  assert.equal(res.tool_use_id, use.id);
  assert.match(res.content, /File created successfully/);
});

test('writeFile is denied in -p default mode without an allow rule', async () => {
  const cwd = tempDir();
  const r = await run([...STREAM, 'go'], { cwd, env: { FAKE_AGENT_SCRIPT: JSON.stringify([{ writeFile: { path: 'x.txt' } }]) } });
  assert.equal(existsSync(join(cwd, 'x.txt')), false);
  assert.equal(r.events.at(-1).permission_denials[0].tool_name, 'Write');
});

test('exit step sets the process exit code', async () => {
  const r = await run([...STREAM, 'go'], { env: { FAKE_AGENT_SCRIPT: JSON.stringify([{ say: 'bye' }, { exit: 3 }, { say: 'never' }]) } });
  assert.equal(r.code, 3);
  assert.equal(r.events.at(-1).result, 'bye');
});

test('--session-id and --resume set the session id', async () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const a = await run([...STREAM, 'x', '--session-id', id]);
  assert.equal(a.events[0].session_id, id);
  const b = await run([...STREAM, 'x', '--resume', id]);
  assert.equal(b.events.at(-1).session_id, id);
});

test('init tools honour --disallowedTools and ENABLE_TOOL_SEARCH=false', async () => {
  const r = await run([...STREAM, 'x', '--disallowedTools', 'Bash'], { env: { ENABLE_TOOL_SEARCH: 'false' } });
  const tools = r.events[0].tools;
  assert.ok(!tools.includes('Bash'));
  assert.ok(!tools.includes('ToolSearch'));
  assert.ok(tools.includes('Read'));
});

test('FAKE_AGENT_RATE_LIMIT emits a rate_limit_event like the real stream', async () => {
  const r = await run([...STREAM, 'x'], { env: { FAKE_AGENT_RATE_LIMIT: '{"five_hour":0.43,"seven_day":0.51}' } });
  const ev = r.events.find((e) => e.type === 'rate_limit_event');
  assert.equal(ev.rate_limit_info.unifiedWindows.five_hour.utilization, 0.43);
});

test('FAKE_AGENT_ARGV_LOG records each launch for command assertions', async () => {
  const log = join(tempDir(), 'argv.log');
  await run(['-p', 'x', '--model', 'haiku'], { env: { FAKE_AGENT_ARGV_LOG: log, LANE_ID: 'lane-9' } });
  const [entry] = readJsonLines(log);
  assert.deepEqual(entry.argv, ['-p', 'x', '--model', 'haiku']);
  assert.equal(entry.laneId, 'lane-9');
});

test('unknown flags fail fast so launch-command typos surface in tests', async () => {
  const r = await run(['-p', 'x', '--output-fromat', 'json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown option '--output-fromat'/);
});

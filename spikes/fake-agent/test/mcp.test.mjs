import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpStdioClient } from '../src/mcp-client.mjs';
import { ECHO_SERVER, EXEC_PATHS, FIXTURES, echoMcpConfig, hookSettings, readJsonLines, run, tempDir } from './helpers.mjs';

const STREAM = ['-p', '--output-format', 'stream-json', '--verbose'];
const script = (steps) => ({ FAKE_AGENT_SCRIPT: JSON.stringify(steps) });
const toolResults = (events) => events.filter((e) => e.type === 'user').map((e) => e.message.content[0]);

test('McpStdioClient initializes, lists tools and follows tools/list_changed', async () => {
  const client = await new McpStdioClient('echo', { command: process.execPath, args: [ECHO_SERVER] }).connect();
  try {
    assert.deepEqual(client.tools.map((t) => t.name).sort(), ['echo', 'fail', 'grow', 'whoami']);
    assert.equal((await client.callTool('echo', { text: 'hi' })).content[0].text, 'hi');
    await client.callTool('grow');
    assert.equal(await client.hasTool('extra'), true);
  } finally {
    await client.close();
  }
});

test('callTool reaches the MCP server from --mcp-config and emits tool_use/tool_result', async () => {
  const log = join(tempDir(), 'echo.log');
  const r = await run(
    [...STREAM, 'go', '--mcp-config', echoMcpConfig({ ECHO_LOG: log, LANE_ID: 'lane-7' }), '--allowedTools', 'mcp__echo__whoami'],
    { env: script([{ callTool: { server: 'echo', tool: 'whoami' } }, { say: 'lane is {{lastToolResult}}' }]) }
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.events[0].mcp_servers, [{ name: 'echo', status: 'connected' }]);
  assert.ok(r.events[0].tools.includes('mcp__echo__whoami'));
  const use = r.events.find((e) => e.message?.content?.[0]?.type === 'tool_use').message.content[0];
  assert.equal(use.name, 'mcp__echo__whoami');
  assert.deepEqual(toolResults(r.events)[0].content, [{ type: 'text', text: 'lane-7' }]);
  assert.equal(r.events.at(-1).result, 'lane is lane-7');
  assert.equal(r.events.at(-1).num_turns, 2);
  assert.deepEqual(readJsonLines(log).map((c) => c.name), ['whoami']);
});

test('a tool outside --allowedTools is denied in -p mode and never reaches the server', async () => {
  const log = join(tempDir(), 'echo.log');
  const r = await run([...STREAM, 'go', '--mcp-config', echoMcpConfig({ ECHO_LOG: log })], {
    env: script([{ callTool: { server: 'echo', tool: 'echo', args: { text: 'x' } } }]),
  });
  const [res] = toolResults(r.events);
  assert.equal(res.is_error, true);
  assert.match(res.content, /haven't granted it yet/);
  assert.equal(r.events.at(-1).permission_denials[0].tool_name, 'mcp__echo__echo');
  assert.deepEqual(readJsonLines(log), []);
});

test('server-wide allow rule, disallowed tools and tool errors', async () => {
  const r = await run(
    [...STREAM, 'go', '--mcp-config', echoMcpConfig(), '--allowedTools', 'mcp__echo', '--disallowedTools', 'mcp__echo__whoami'],
    {
      env: script([
        { callTool: { server: 'echo', tool: 'echo', args: { text: 'ok' } } },
        { callTool: { server: 'echo', tool: 'whoami' } },
        { callTool: { server: 'echo', tool: 'fail' } },
      ]),
    }
  );
  const [ok, disallowed, failed] = toolResults(r.events);
  assert.equal(ok.is_error, false);
  assert.match(disallowed.content, /No such tool available: mcp__echo__whoami/);
  assert.equal(failed.is_error, true);
  assert.ok(!r.events[0].tools.includes('mcp__echo__whoami'));
});

test('a tool added at runtime via list_changed is callable', async () => {
  const r = await run([...STREAM, 'go', '--mcp-config', echoMcpConfig(), '--allowedTools', 'mcp__echo'], {
    env: script([{ callTool: { server: 'echo', tool: 'grow' } }, { callTool: { server: 'echo', tool: 'extra' } }]),
  });
  assert.deepEqual(toolResults(r.events)[1].content, [{ type: 'text', text: 'extra-ok' }]);
});

test('--max-turns stops the run with error_max_turns', async () => {
  const call = { callTool: { server: 'echo', tool: 'echo', args: { text: 'x' } } };
  const r = await run([...STREAM, 'go', '--mcp-config', echoMcpConfig(), '--allowedTools', 'mcp__echo', '--max-turns', '2'], {
    env: script([call, call, call]),
  });
  assert.equal(r.code, 1);
  assert.equal(r.events.at(-1).subtype, 'error_max_turns');
  assert.equal(toolResults(r.events).length, 2);
});

test('--max-turns 1 matches the real error_max_turns result (tool call, then stop)', async () => {
  const real = readJsonLines(join(FIXTURES, 'claude-p-max-turns.jsonl')).at(-1);
  const r = await run([...STREAM, 'go', '--mcp-config', echoMcpConfig(), '--allowedTools', 'mcp__echo', '--max-turns', '1'], {
    env: script([{ callTool: { server: 'echo', tool: 'whoami' } }, { say: 'never sent' }]),
  });
  const fake = r.events.at(-1);
  assert.equal(r.code, 1);
  for (const key of ['subtype', 'is_error', 'num_turns', 'terminal_reason', 'stop_reason', 'errors']) {
    assert.deepEqual(fake[key], real[key], key);
  }
  assert.equal('result' in fake, false);
  assert.deepEqual(Object.keys(fake).filter((k) => !(k in real)), []);
});

test('hooks from --settings fire in order and a PreToolUse exit 2 blocks the call', async () => {
  const dir = tempDir();
  const hookLog = join(dir, 'hooks.log');
  const echoLog = join(dir, 'echo.log');
  const r = await run(
    [...STREAM, 'go', '--mcp-config', echoMcpConfig({ ECHO_LOG: echoLog }), '--allowedTools', 'mcp__echo', '--settings', hookSettings()],
    {
      env: {
        ...script([{ callTool: { server: 'echo', tool: 'whoami' } }, { callTool: { server: 'echo', tool: 'echo', args: { text: 'x' } } }]),
        HOOK_LOG: hookLog,
        BLOCK_TOOL: 'mcp__echo__echo',
      },
    }
  );
  const events = readJsonLines(hookLog).map((h) => h.hook_event_name + (h.tool_name ? `:${h.tool_name}` : ''));
  assert.deepEqual(events, [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse:mcp__echo__whoami',
    'PostToolUse:mcp__echo__whoami',
    'PreToolUse:mcp__echo__echo',
    'Stop',
    'SessionEnd',
  ]);
  const blocked = toolResults(r.events)[1];
  assert.equal(blocked.is_error, true);
  assert.equal(blocked.content, 'blocked by gate');
  assert.deepEqual(readJsonLines(echoLog).map((c) => c.name), ['whoami']);
  assert.equal(readJsonLines(hookLog)[0].session_id, r.events[0].session_id);
});

const STUB = join(EXEC_PATHS, 'stub-mcp-server.mjs');
const sdkInstalled = existsSync(join(EXEC_PATHS, 'node_modules/@modelcontextprotocol/sdk'));

test('talks to the spike stub Brain server built on @modelcontextprotocol/sdk', { skip: !sdkInstalled && 'run npm install in spikes/exec-paths' }, async () => {
  const dir = tempDir();
  const cfgPath = join(dir, 'mcp.json');
  const stubLog = join(dir, 'stub.log');
  writeFileSync(
    cfgPath,
    JSON.stringify({
      mcpServers: { stub: { type: 'stdio', command: process.execPath, args: [STUB], env: { LANE_ID: 'lane-T', STUB_LOG: stubLog } } },
    })
  );
  const r = await run([...STREAM, 'go', '--mcp-config', cfgPath, '--strict-mcp-config', '--allowedTools', 'mcp__stub'], {
    env: script([
      { callTool: { server: 'stub', tool: 'ping' } },
      { callTool: { server: 'stub', tool: 'claim_task', args: { taskId: 'T-9' } } },
      { callTool: { server: 'stub', tool: 'late_tool' } },
      { say: '{{lastToolResult}}' },
    ]),
  });
  assert.equal(r.code, 0, r.stderr);
  const results = toolResults(r.events).map((c) => c.content[0].text);
  assert.equal(results[0], 'pong from lane lane-T');
  assert.equal(JSON.parse(results[1]).id, 'T-9');
  assert.equal(results[2], 'late-tool-marker-42');
  assert.deepEqual(
    readJsonLines(stubLog).map((c) => c.tool),
    ['ping', 'claim_task', 'late_tool_registered', 'late_tool']
  );
});

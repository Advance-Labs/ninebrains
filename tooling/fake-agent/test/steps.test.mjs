import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir } from './helpers.mjs';

const STREAM = ['-p', '--output-format', 'stream-json', '--verbose'];
const lines = (stdout) => stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('bash step runs only when Bash is allowed', async () => {
  const cwd = tempDir();
  const env = { FAKE_AGENT_SCRIPT: JSON.stringify([{ bash: 'echo hi > out.txt' }]) };

  const denied = await run([...STREAM, 'go'], { cwd, env });
  assert.equal(denied.code, 0);
  assert.equal(existsSync(join(cwd, 'out.txt')), false);
  const deniedResult = lines(denied.stdout).at(-1);
  assert.equal(deniedResult.permission_denials[0].tool_name, 'Bash');

  const allowed = await run([...STREAM, '--allowedTools=Bash', 'go'], { cwd, env });
  assert.equal(allowed.code, 0);
  assert.equal(existsSync(join(cwd, 'out.txt')), true);
});

test('FAKE_AGENT_USAGE sets per-message usage', async () => {
  const r = await run([...STREAM, 'hi'], { env: { FAKE_AGENT_USAGE: '{"output_tokens":7}' } });
  const assistant = lines(r.stdout).find((e) => e.type === 'assistant');
  assert.equal(assistant.message.usage.output_tokens, 7);
});

test('accepts --max-budget-usd and --permission-prompts', async () => {
  const r = await run([...STREAM, '--max-budget-usd=1.5', '--permission-prompts=none', 'hi']);
  assert.equal(r.code, 0);
});

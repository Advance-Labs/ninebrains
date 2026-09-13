import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolateArgs } from '../src/steps.mjs';

const ctx = (prompt, lastToolResult = '') => ({ state: { prompt, lastToolResult } });

test('callTool args interpolate the prompt, a prompt capture and the last tool result', () => {
  const prompt = 'Brain job j-42: Write docs\n\ncall complete_job with jobId "j-42" and a summary.';
  const args = {
    jobId: '{{prompt:jobId "([A-Za-z0-9_-]+)"}}',
    summary: 'finished {{prompt:^Brain job [^:]+: (.*)$}}',
    nested: ['{{lastToolResult}}', 7, { keep: true }],
  };
  assert.deepEqual(interpolateArgs(args, ctx(prompt, 'ok')), {
    jobId: 'j-42',
    summary: 'finished Write docs',
    nested: ['ok', 7, { keep: true }],
  });
});

test('a capture that does not match becomes an empty string', () => {
  assert.equal(interpolateArgs('{{prompt:missing (\\d+)}}', ctx('nothing here')), '');
});

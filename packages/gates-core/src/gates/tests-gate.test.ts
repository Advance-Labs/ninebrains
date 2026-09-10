import { describe, expect, it, vi } from 'vitest';
import { makeContext, makeJob } from '../test-utils';
import type { CommandResult } from '../types';
import { TESTS_LOG_LINES, testsGate } from './tests-gate';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

function withCommand(result: CommandResult | Error) {
  const runCommand = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { runCommand, ctx: makeContext({ job: { kind: 'code' }, capabilities: { runCommand } }) };
}

describe('testsGate', () => {
  it('passes on exit 0 and attaches at most 200 lines of log tail', async () => {
    const { runCommand, ctx } = withCommand({ exitCode: 0, stdout: lines(500), stderr: '' });
    const result = await testsGate({ command: 'pnpm test' }).run(ctx);

    expect(result.pass).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(
      'pnpm test',
      expect.objectContaining({ cwd: '/work/lane-1' })
    );
    const log = String(ctx.evidence.data.get(result.evidence[0].path));
    const body = log.split('\n\n')[1].trim().split('\n');
    expect(body).toHaveLength(TESTS_LOG_LINES);
    expect(body.at(-1)).toBe('line 500');
    expect(body[0]).toBe('line 301');
    expect(result.metrics?.exitCode).toBe(0);
  });

  it('fails on a non-zero exit with the tail of the output in the feedback', async () => {
    const { ctx } = withCommand({
      exitCode: 1,
      stdout: lines(3),
      stderr: 'AssertionError: expected 2 to be 3',
    });
    const result = await testsGate({ command: 'pnpm test' }).run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('`pnpm test` exited with code 1');
    expect(result.feedback).toContain('AssertionError: expected 2 to be 3');
  });

  it('fails when the command timed out even if an exit code came back', async () => {
    const { ctx } = withCommand({ exitCode: 0, stdout: '', stderr: '', timedOut: true });
    const result = await testsGate({ command: 'pnpm test' }).run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('timed out');
  });

  it('fails when the command cannot be started', async () => {
    const { ctx } = withCommand(new Error('spawn ENOENT'));
    const result = await testsGate({ command: 'pnpm test' }).run(ctx);
    expect(result).toMatchObject({ pass: false, evidence: [] });
    expect(result.feedback).toContain('spawn ENOENT');
  });

  it('applies to code and UI jobs by default and needs a command', () => {
    const gate = testsGate({ command: 'npm test' });
    expect(gate.appliesTo(makeJob({ kind: 'code' }))).toBe(true);
    expect(gate.appliesTo(makeJob({ kind: 'research' }))).toBe(false);
    expect(() => testsGate({ command: '  ' })).toThrow();
  });
});

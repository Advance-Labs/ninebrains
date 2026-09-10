import { describe, expect, it, vi } from 'vitest';
import { parseReviewerVerdict } from '../reviewer-verdict';
import { makeContext, makeJob } from '../test-utils';
import type { CommandResult } from '../types';
import { reviewerGate, securityReviewGate } from './reviewer-gate';

const DIFF = 'diff --git a/src/app.ts b/src/app.ts\n+export const plans = 3;\n';

function setup(reply: string, commands: Record<string, Partial<CommandResult>> = {}, job = {}) {
  const runCommand = vi.fn(async (command: string) => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    ...(command.startsWith('git diff') ? { stdout: DIFF } : {}),
    ...commands[command],
  }));
  const spawnReviewer = vi.fn(async () => ({ text: reply }));
  const ctx = makeContext({
    job: { kind: 'code', ...job },
    capabilities: { runCommand, spawnReviewer },
  });
  return { ctx, runCommand, spawnReviewer };
}

describe('reviewerGate', () => {
  it('sends job, diff and evidence to a read-only reviewer and passes on approval', async () => {
    const { ctx, runCommand, spawnReviewer } = setup('{"pass": true, "issues": []}');
    const result = await reviewerGate().run(ctx);

    expect(result.pass).toBe(true);
    expect(runCommand).toHaveBeenCalledWith(
      'git diff --no-color HEAD',
      expect.objectContaining({ cwd: '/work/lane-1' })
    );
    const [prompt, opts] = spawnReviewer.mock.calls[0] as unknown as [
      string,
      { readOnly: boolean; purpose: string },
    ];
    expect(prompt).toContain('Add a pricing table');
    expect(prompt).toContain('+export const plans = 3;');
    expect(opts).toMatchObject({ readOnly: true, purpose: 'reviewer' });
    expect(result.evidence.map((e) => e.kind)).toEqual(['diff', 'json']);
  });

  it('diffs against the job baseRef and lists untracked files', async () => {
    const { ctx, runCommand, spawnReviewer } = setup(
      '{"pass": true, "issues": []}',
      {
        'git ls-files --others --exclude-standard': { stdout: 'src/new-file.ts\n' },
      },
      { baseRef: 'abc1234' }
    );
    await reviewerGate().run(ctx);
    expect(runCommand.mock.calls[0][0]).toBe('git diff --no-color abc1234');
    expect((spawnReviewer.mock.calls[0] as unknown as [string])[0]).toContain('src/new-file.ts');
  });

  it('fails on a malformed reply', async () => {
    const { ctx } = setup('I think this looks good overall.');
    const result = await reviewerGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toMatch(/not a valid verdict/);
    expect(result.evidence.map((e) => e.kind)).toEqual(['diff', 'text']);
  });

  it('fails with the listed issues when the reviewer rejects', async () => {
    const { ctx } = setup(
      '```json\n{"pass": false, "issues": [{"message": "No test for the empty state", "file": "src/app.ts"}]}\n```'
    );
    const result = await reviewerGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('- No test for the empty state (src/app.ts)');
    expect(result.metrics?.issues).toBe(1);
  });

  it('refuses an unsafe baseRef without running a command', async () => {
    const { ctx, runCommand } = setup('{}', {}, { baseRef: 'main; rm -rf /' });
    const result = await reviewerGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('fails when there is nothing to review or the diff command fails', async () => {
    const empty = setup('{}', { 'git diff --no-color HEAD': { stdout: '' } });
    expect((await reviewerGate().run(empty.ctx)).feedback).toMatch(/nothing to review/);

    const broken = setup('{}', {
      'git diff --no-color HEAD': { exitCode: 128, stderr: 'fatal: bad revision' },
    });
    const result = await reviewerGate().run(broken.ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('fatal: bad revision');
  });

  it('securityReviewGate uses its own id, purpose and brief, and only applies to code', async () => {
    const { ctx, spawnReviewer } = setup('{"pass": true, "issues": []}');
    const gate = securityReviewGate();
    expect(gate.id).toBe('security-review');
    expect(gate.appliesTo(makeJob({ kind: 'research' }))).toBe(false);
    await gate.run(ctx);
    const [prompt, opts] = spawnReviewer.mock.calls[0] as unknown as [string, { purpose: string }];
    expect(prompt).toMatch(/security problems only/);
    expect(opts.purpose).toBe('security-review');
  });
});

describe('parseReviewerVerdict', () => {
  it.each([
    ['{"pass": true, "issues": []}', true],
    ['  {"pass": true, "issues": ["nit: rename x"]}\n', true],
    ['```json\n{"pass": true, "issues": []}\n```', true],
    ['Sure! {"pass": true, "issues": []}', false],
    ['```json\n{"pass": true, "issues": []}\n```\nHope that helps', false],
    ['{"pass": "true", "issues": []}', false],
    ['{"pass": true}', false],
    ['{"pass": false, "issues": []}', false],
    ['{"pass": false, "issues": [{"message": "x", "severity": "catastrophic"}]}', false],
    ['[true]', false],
  ])('%s → ok=%s', (text, ok) => {
    expect(parseReviewerVerdict(text).ok).toBe(ok);
  });
});

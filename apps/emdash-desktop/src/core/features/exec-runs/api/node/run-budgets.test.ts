import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ExecRunSupervisor } from './run-supervisor';
import type { ExecRunEvent, ExecRunSpec } from './types';

const FAKE_CLAUDE = fileURLToPath(
  new URL('../../../../../../../../tooling/fake-agent/bin/fake-claude.mjs', import.meta.url)
);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-budgets-')));
const worktrees = join(root, 'worktrees');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
function script(body: string): string {
  const path = join(root, `bin-${randomUUID()}.sh`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const fakeClaude = (env: Record<string, string>) =>
  script(
    [
      ...Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}`),
      `exec ${q(process.execPath)} ${q(FAKE_CLAUDE)} "$@"`,
    ].join('\n')
  );
/** A stand-in `codex exec --json`: prints Codex events, ignores argv and stdin. */
const fakeCodex = (lines: string[]) => script(lines.join('\n'));

function lane(): string {
  const dir = join(worktrees, `lane-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
const supervisor = (binary: string, userDataDir = join(root, 'userData')) =>
  new ExecRunSupervisor({
    userDataDir,
    resolveBinary: async () => binary,
    allowedRoots: () => [worktrees],
    maxConcurrentRuns: 4,
  });
const spec = (over: Partial<ExecRunSpec> = {}): ExecRunSpec => ({
  runId: `run-${randomUUID().slice(0, 8)}`,
  provider: 'claude',
  preset: 'worker',
  cwd: lane(),
  prompt: 'go',
  budgets: { wallClockMs: 20_000 },
  ...over,
});
const records = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('SEC-29 budgets survive restart', () => {
  it('persists token and time counters to the transcript as the run goes', async () => {
    const steps = [{ say: 'a' }, { sleep: 50 }, { say: 'b' }, { sleep: 50 }, { say: 'c' }];
    const sup = supervisor(
      fakeClaude({
        FAKE_AGENT_SCRIPT: JSON.stringify(steps),
        FAKE_AGENT_USAGE: '{"output_tokens":400}',
      })
    );
    const result = await sup.run(spec());
    const budget = records(result.transcriptPath).filter((r) => r.type === 'ninebrains.budget');
    expect(budget.length).toBeGreaterThanOrEqual(3);
    const totals = budget.map((r) => r.totalTokens);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(totals.at(-1)).toBeGreaterThanOrEqual(1200);
    expect(budget.every((r) => typeof r.elapsedMs === 'number')).toBe(true);
  });

  it('closes a run a dead app left open as killed, with its last counters', async () => {
    const userData = join(root, 'restarted');
    const runs = join(userData, 'ninebrains', 'runs');
    mkdirSync(join(runs, 'run-cut'), { recursive: true });
    writeFileSync(join(runs, 'run-cut', 'mcp.json'), '{"NINEBRAINS_TOKEN":"left-behind"}');
    const usage = {
      inputTokens: 100,
      outputTokens: 800,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    writeFileSync(
      join(runs, 'run-cut.jsonl'),
      [
        { type: 'ninebrains.header', runId: 'run-cut', provider: 'claude', preset: 'worker' },
        { type: 'assistant', message: { usage: {} } },
        { type: 'ninebrains.budget', usage, totalTokens: 900, elapsedMs: 4000 },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n'
    );
    writeFileSync(
      join(runs, 'run-done.jsonl'),
      `${JSON.stringify({ type: 'ninebrains.header', runId: 'run-done' })}\n${JSON.stringify({ type: 'ninebrains.outcome', reason: 'completed' })}\n`
    );

    const sup = supervisor('/usr/bin/false', userData);
    const events: ExecRunEvent[] = [];
    sup.onEvent((e) => events.push(e));
    const recovered = await sup.recover();

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      runId: 'run-cut',
      ok: false,
      reason: 'killed',
      totalTokens: 900,
      durationMs: 4000,
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'finished', runId: 'run-cut' }));
    expect(records(join(runs, 'run-cut.jsonl')).at(-1)).toMatchObject({
      type: 'ninebrains.outcome',
      reason: 'killed',
      recovered: true,
      totalTokens: 900,
    });
    expect(existsSync(join(runs, 'run-cut'))).toBe(false); // the leftover token file is gone
    expect(records(join(runs, 'run-done.jsonl'))).toHaveLength(2);
    expect(await sup.recover()).toEqual([]); // idempotent
  });
});

describe('SEC-29 Codex budgets come from its event stream', () => {
  it('enforces the wall clock on a Codex run', async () => {
    const sup = supervisor(
      fakeCodex([`echo '{"type":"thread.started","thread_id":"t1"}'`, 'sleep 30'])
    );
    const result = await sup.run(spec({ provider: 'codex', budgets: { wallClockMs: 300 } }));
    expect(result).toMatchObject({ ok: false, reason: 'wall-clock' });
    expect(result.durationMs).toBeLessThan(4000);
  });

  it('enforces the token budget from turn.completed usage', async () => {
    const turn = `echo '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":400}}'`;
    const sup = supervisor(
      fakeCodex([
        `echo '{"type":"thread.started","thread_id":"t1"}'`,
        ...Array.from({ length: 6 }, () => [turn, 'sleep 0.2']).flat(),
      ])
    );
    const result = await sup.run(
      spec({ provider: 'codex', budgets: { wallClockMs: 20_000, maxTokens: 1000 } })
    );
    expect(result).toMatchObject({ ok: false, reason: 'tokens' });
    expect(result.totalTokens).toBeGreaterThan(1000);
    expect(result.totalTokens).toBeLessThan(6 * 400);
    const budget = records(result.transcriptPath).filter((r) => r.type === 'ninebrains.budget');
    expect(budget.map((r) => r.totalTokens)).toEqual([400, 800, 1200]);
  });
});

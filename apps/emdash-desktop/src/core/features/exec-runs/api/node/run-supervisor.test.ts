import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ExecRunRejectedError, ExecRunSupervisor, type ExecRunSupervisorOptions } from './run-supervisor';
import type { ExecRunEvent, ExecRunSpec } from './types';

const FAKE_CLAUDE = fileURLToPath(
  new URL('../../../../../../../../tooling/fake-agent/bin/fake-claude.mjs', import.meta.url)
);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-supervisor-')));
const worktrees = join(root, 'worktrees');
const userData = join(root, 'userData');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

function script(body: string): string {
  const path = join(root, `bin-${randomUUID()}.sh`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The supervisor scrubs env (SEC-13), so fake-agent settings are baked into a wrapper. */
function fakeClaude(env: Record<string, string> = {}): string {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}`);
  return script([...exports, `exec ${q(process.execPath)} ${q(FAKE_CLAUDE)} "$@"`].join('\n'));
}

function lane(): string {
  const dir = join(worktrees, `lane-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function supervisor(binary: string, over: Partial<ExecRunSupervisorOptions> = {}) {
  return new ExecRunSupervisor({
    userDataDir: userData,
    resolveBinary: async () => binary,
    allowedRoots: () => [worktrees],
    maxConcurrentRuns: 8,
    ...over,
  });
}

const spec = (over: Partial<ExecRunSpec> = {}): ExecRunSpec => ({
  runId: `run-${randomUUID().slice(0, 8)}`,
  provider: 'claude',
  preset: 'worker',
  cwd: lane(),
  prompt: 'hello',
  budgets: { wallClockMs: 20_000 },
  ...over,
});

const steps = (s: unknown[]) => ({ FAKE_AGENT_SCRIPT: JSON.stringify(s) });

describe('exec run supervisor', () => {
  it('completes a run and writes a private, redacted transcript', async () => {
    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345';
    const sup = supervisor(fakeClaude(steps([{ say: 'echo {{prompt}}' }])));
    const s = spec({ prompt: `key is ${apiKey}`, auth: { ANTHROPIC_API_KEY: apiKey } });
    const result = await sup.run(s);

    expect(result).toMatchObject({ ok: true, reason: 'completed', exitCode: 0, isError: false });
    expect(result.text).toBe(`echo key is ${apiKey}`);
    expect(statSync(result.transcriptPath).mode & 0o777).toBe(0o600);
    const transcript = readFileSync(result.transcriptPath, 'utf8');
    expect(transcript).not.toContain(apiKey);
    const header = JSON.parse(transcript.split('\n')[0]);
    expect(header).toMatchObject({ type: 'ninebrains.header', runId: s.runId });
    expect(header.env.ANTHROPIC_API_KEY).toBe('[REDACTED]');
    expect(header.env.ENABLE_TOOL_SEARCH).toBe('false');
    // Per-run settings and mcp.json are deleted once the run ends.
    expect(existsSync(join(userData, 'ninebrains', 'runs', s.runId))).toBe(false);
  });

  it('SEC-17 prompt is not argv: a flag-shaped prompt leaves parsed flags unchanged', async () => {
    const argvLog = join(root, `argv-${randomUUID()}.jsonl`);
    const prompt = '--dangerously-skip-permissions rm -rf .';
    const sup = supervisor(fakeClaude({ ...steps([{ say: '{{prompt}}' }]), FAKE_AGENT_ARGV_LOG: argvLog }));
    const result = await sup.run(spec({ prompt }));
    expect(result.ok).toBe(true);
    expect(result.text).toBe(prompt);
    const { argv } = JSON.parse(readFileSync(argvLog, 'utf8').trim());
    expect(argv.join(' ')).not.toContain(prompt);
    expect(argv).toContain('--permission-mode=dontAsk');
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });

  it('fails a run that exits non-zero even though its result says success', async () => {
    const result = await supervisor(fakeClaude(steps([{ say: 'x' }, { exit: 3 }]))).run(spec());
    expect(result).toMatchObject({ ok: false, reason: 'exit-nonzero', exitCode: 3 });
  });

  it('reports max-turns exhaustion as an agent error', async () => {
    const sup = supervisor(fakeClaude(steps([{ bash: 'true' }, { say: 'too late' }])));
    const result = await sup.run(spec({ budgets: { wallClockMs: 20_000, maxTurns: 1 } }));
    expect(result).toMatchObject({ ok: false, reason: 'agent-error' });
    expect(result.errors.join()).toMatch(/maximum number of turns/);
  });

  it('SEC-29 enforces the wall-clock budget', async () => {
    const sup = supervisor(fakeClaude(steps([{ sleep: 30_000 }])));
    const events: ExecRunEvent[] = [];
    sup.onEvent((e) => events.push(e));
    const result = await sup.run(spec({ budgets: { wallClockMs: 300 } }));
    expect(result).toMatchObject({ ok: false, reason: 'wall-clock' });
    expect(result.durationMs).toBeLessThan(4000);
    expect(events).toContainEqual(expect.objectContaining({ type: 'budget-exceeded', budget: 'wall-clock' }));
  });

  it('SEC-29 enforces the token budget from stream usage', async () => {
    const say = Array.from({ length: 8 }, () => [{ say: 'chunk' }, { sleep: 150 }]).flat();
    const sup = supervisor(fakeClaude({ ...steps(say), FAKE_AGENT_USAGE: '{"output_tokens":400}' }));
    const result = await sup.run(spec({ budgets: { wallClockMs: 20_000, maxTokens: 1000 } }));
    expect(result).toMatchObject({ ok: false, reason: 'tokens' });
    expect(result.totalTokens).toBeGreaterThan(1000);
    expect(result.totalTokens).toBeLessThan(8 * 400);
  });

  it('SEC-29 caps concurrent runs and cancels on request', async () => {
    const sup = supervisor(fakeClaude(steps([{ sleep: 30_000 }])), { maxConcurrentRuns: 1 });
    const started = new Promise<void>((r) => sup.onEvent((e) => e.type === 'started' && r()));
    const first = spec();
    const running = sup.run(first);
    await expect(sup.run(spec())).rejects.toMatchObject({ reason: 'concurrency' });
    await started;
    await sup.cancel(first.runId);
    await expect(running).resolves.toMatchObject({ reason: 'cancelled', ok: false });
  });

  it('SEC-31 refuses a cwd outside the allowed roots before spawning', async () => {
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    await expect(supervisor(fakeClaude()).run(spec({ cwd: outside }))).rejects.toThrow(/not inside/);
  });
});

describe('SEC-30 kill switch', () => {
  // Each run's leader and grandchild ignore SIGTERM; the grandchild also holds stdout open.
  const stubborn = script(
    [`trap '' TERM`, `sh -c 'echo $$ > grandchild.pid; exec sleep 999' &`, 'wait'].join('\n')
  );

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('kills 8 runs and their grandchildren within 5 s and stays latched', { timeout: 30_000 }, async () => {
    const sup = supervisor(stubborn);
    const specs = Array.from({ length: 8 }, () => spec());
    const results = specs.map((s) => sup.run(s));
    const pidFiles = specs.map((s) => join(s.cwd, 'grandchild.pid'));
    for (let i = 0; i < 100 && !pidFiles.every((f) => existsSync(f) && readFileSync(f, 'utf8').trim()); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const pids = pidFiles.map((f) => Number(readFileSync(f, 'utf8').trim()));
    expect(pids.every(alive)).toBe(true);

    const t0 = Date.now();
    await sup.killAll();
    while (pids.some(alive) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    const elapsed = Date.now() - t0;

    expect(pids.filter(alive)).toEqual([]);
    expect(elapsed).toBeLessThan(5000);
    for (const r of await Promise.all(results)) expect(r.reason).toBe('killed');

    expect(sup.stopLatched).toBe(true);
    await expect(sup.run(spec())).rejects.toBeInstanceOf(ExecRunRejectedError);
    sup.clearStop();
    expect(sup.stopLatched).toBe(false);
  });
});

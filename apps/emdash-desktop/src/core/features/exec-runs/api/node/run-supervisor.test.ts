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
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  ExecRunRejectedError,
  ExecRunSupervisor,
  type ExecRunSupervisorOptions,
} from './run-supervisor';
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
    const sup = supervisor(
      fakeClaude({ ...steps([{ say: '{{prompt}}' }]), FAKE_AGENT_ARGV_LOG: argvLog })
    );
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
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'budget-exceeded', budget: 'wall-clock' })
    );
  });

  it('SEC-29 enforces the token budget from stream usage', async () => {
    const say = Array.from({ length: 8 }, () => [{ say: 'chunk' }, { sleep: 150 }]).flat();
    const sup = supervisor(
      fakeClaude({ ...steps(say), FAKE_AGENT_USAGE: '{"output_tokens":400}' })
    );
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
    await expect(supervisor(fakeClaude()).run(spec({ cwd: outside }))).rejects.toThrow(
      /not inside/
    );
  });

  it('T43 refuses an unattended run at the lane worktree root by default', async () => {
    const laneRoot = lane();
    await expect(
      supervisor(fakeClaude(), { allowedRoots: () => [laneRoot] }).run(spec({ cwd: laneRoot }))
    ).rejects.toThrow(/not inside/);
  });

  it('T43 allows an unattended run at exactly its own lane worktree root', async () => {
    const laneRoot = lane();
    const result = await supervisor(fakeClaude(), {
      allowedRoots: () => [laneRoot],
      exactRootsAllowed: () => [laneRoot],
    }).run(spec({ cwd: laneRoot }));
    expect(result.ok).toBe(true);
  });

  it('T43 still refuses a shared root (e.g. checkoutRoot) exactly, even alongside a lane root', async () => {
    const laneRoot = lane();
    const checkoutRoot = join(root, `checkouts-${randomUUID().slice(0, 8)}`);
    mkdirSync(checkoutRoot, { recursive: true });
    await expect(
      supervisor(fakeClaude(), {
        allowedRoots: () => [laneRoot, checkoutRoot],
        exactRootsAllowed: () => [laneRoot],
      }).run(spec({ cwd: checkoutRoot }))
    ).rejects.toThrow(/not inside/);
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

  it(
    'kills 8 runs and their grandchildren within 5 s and stays latched',
    { timeout: 30_000 },
    async () => {
      const sup = supervisor(stubborn);
      const specs = Array.from({ length: 8 }, () => spec());
      const results = specs.map((s) => sup.run(s));
      const pidFiles = specs.map((s) => join(s.cwd, 'grandchild.pid'));
      for (
        let i = 0;
        i < 100 && !pidFiles.every((f) => existsSync(f) && readFileSync(f, 'utf8').trim());
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const pids = pidFiles.map((f) => Number(readFileSync(f, 'utf8').trim()));
      expect(pids.every(alive)).toBe(true);

      const t0 = Date.now();
      await sup.killAll();
      while (pids.some(alive) && Date.now() - t0 < 5000)
        await new Promise((r) => setTimeout(r, 50));
      const elapsed = Date.now() - t0;

      expect(pids.filter(alive)).toEqual([]);
      expect(elapsed).toBeLessThan(5000);
      for (const r of await Promise.all(results)) expect(r.reason).toBe('killed');

      expect(sup.stopLatched).toBe(true);
      await expect(sup.run(spec())).rejects.toBeInstanceOf(ExecRunRejectedError);
      sup.clearStop();
      expect(sup.stopLatched).toBe(false);
    }
  );

  // SEC-30: under load, the OS can recycle a process-group id between a leader exiting and the
  // reap signal that follows it, so `process.kill(-pid, ...)` can throw EPERM against a group we
  // never started. These two tests inject exactly that EPERM once, only on the process-group
  // (negative-pid) form of the call `signalGroup` makes, and let every other `process.kill` call
  // (including this file's own `alive()` liveness checks) through to the real implementation, so
  // the underlying processes are still genuinely reaped and nothing is left running afterward.
  function injectOneGroupEperm(): { restore: () => void } {
    const realKill = process.kill.bind(process);
    let thrown = false;
    const spy = vi
      .spyOn(process, 'kill')
      .mockImplementation((pid: number, signal?: string | number) => {
        if (!thrown && pid < 0) {
          thrown = true;
          throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
        }
        return realKill(pid, signal);
      });
    return { restore: () => spy.mockRestore() };
  }

  it('does not hang a run when its reap signal hits a recycled process-group id (EPERM)', async () => {
    // `signalGroup` itself already treats EPERM like ESRCH (the group is gone from our side
    // either way), so this resolves clean with no reported error — exactly as an already-gone
    // group (ESRCH) always has. Before that fix, this EPERM was an uncaught exception thrown
    // from inside the `close` handler, before `resolve(result)`, so the run never settled.
    const injected = injectOneGroupEperm();
    try {
      const result = await supervisor(fakeClaude(steps([{ say: 'hi' }]))).run(spec());
      expect(result).toMatchObject({ ok: true, reason: 'completed', errors: [] });
    } finally {
      injected.restore();
    }
  });

  it('does not hang a run and reports it when the reap signal fails for an unexpected reason', async () => {
    // Anything `signalGroup` doesn't already recognize as "the group is gone" (unlike ESRCH and
    // EPERM) is a genuine backstop case: `resolve(result)` still must not depend on it, and
    // unlike the tolerated codes above, it should show up rather than vanish silently.
    //
    // The mock only throws for this run's own leader pid (learned from its `started` event,
    // negated to match `signalGroup`'s `-pid` form) — never "the first negative-pid call
    // system-wide". `killAll()` races its own deadline against the real `terminateGroup` chain
    // (SEC-30), so a *previous* test's trailing, timer-delayed final SIGKILL can still be in
    // flight when this test's spy is installed; an unscoped mock would consume its one-shot
    // throw on that unrelated call instead of on this run's own post-close reap.
    const sup = supervisor(fakeClaude(steps([{ say: 'hi' }])));
    let leaderPid: number | undefined;
    sup.onEvent((e) => {
      if (e.type === 'started') leaderPid = e.pid;
    });
    const realKill = process.kill.bind(process);
    let thrown = false;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (!thrown && leaderPid !== undefined && pid === -leaderPid) {
        thrown = true;
        throw Object.assign(new Error('kill EIO'), { code: 'EIO' });
      }
      return realKill(pid, signal);
    });
    try {
      const result = await sup.run(spec());
      expect(result).toMatchObject({ ok: true, reason: 'completed' });
      expect(result.errors.join()).toMatch(/failed to reap leftover processes/);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('killAll still kills every run and stays latched when one signal hits a recycled pid', async () => {
    const injected = injectOneGroupEperm();
    try {
      const sup = supervisor(stubborn);
      const specs = Array.from({ length: 2 }, () => spec());
      const results = specs.map((s) => sup.run(s));
      const pidFiles = specs.map((s) => join(s.cwd, 'grandchild.pid'));
      for (
        let i = 0;
        i < 100 && !pidFiles.every((f) => existsSync(f) && readFileSync(f, 'utf8').trim());
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const pids = pidFiles.map((f) => Number(readFileSync(f, 'utf8').trim()));
      expect(pids.every(alive)).toBe(true);

      await sup.killAll();
      for (let i = 0; i < 100 && pids.some(alive); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(pids.filter(alive)).toEqual([]);
      for (const r of await Promise.all(results)) expect(r.reason).toBe('killed');
      expect(sup.stopLatched).toBe(true);
      sup.clearStop();
    } finally {
      injected.restore();
    }
  });

  it('killAll still completes and stays latched, and reports it, when a STOP-path signal fails unexpectedly', async () => {
    // Unlike the two EPERM tests above, EIO isn't a code `signalGroup` treats as "the group is
    // gone" — it should be reported, not swallowed. This is one of the three STOP-path signals
    // inside terminateGroup, not the post-close reap the other two tests cover.
    //
    // The mock only throws for these two runs' own leader pids (learned from their `started`
    // events, negated to match `signalGroup`'s `-pid` form) — never "the first negative-pid call
    // system-wide". terminateGroup's own trailing, 50ms-delayed final SIGKILL from the *previous*
    // test's killAll can still be in flight when this test's spy is installed (`run.done` settles
    // before that tail finishes), and an unscoped mock would consume its one-shot throw on that
    // unrelated call instead of on anything this test does.
    const sup = supervisor(stubborn);
    const events: ExecRunEvent[] = [];
    sup.onEvent((e) => events.push(e));
    const specs = Array.from({ length: 2 }, () => spec());
    const results = specs.map((s) => sup.run(s));
    for (let i = 0; i < 100 && events.filter((e) => e.type === 'started').length < 2; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const leaderPids = events
      .filter((e): e is Extract<ExecRunEvent, { type: 'started' }> => e.type === 'started')
      .map((e) => e.pid);
    expect(leaderPids).toHaveLength(2);

    const realKill = process.kill.bind(process);
    let thrown = false;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (!thrown && leaderPids.includes(-pid)) {
        thrown = true;
        throw Object.assign(new Error('kill EIO'), { code: 'EIO' });
      }
      return realKill(pid, signal);
    });
    try {
      const pidFiles = specs.map((s) => join(s.cwd, 'grandchild.pid'));
      for (
        let i = 0;
        i < 100 && !pidFiles.every((f) => existsSync(f) && readFileSync(f, 'utf8').trim());
        i++
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const pids = pidFiles.map((f) => Number(readFileSync(f, 'utf8').trim()));
      expect(pids.every(alive)).toBe(true);

      await sup.killAll();
      for (let i = 0; i < 100 && pids.some(alive); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // killAll's own liveness/latch guarantees hold exactly as without the injected failure.
      expect(pids.filter(alive)).toEqual([]);
      const settled = await Promise.all(results);
      for (const r of settled) expect(r.reason).toBe('killed');
      expect(sup.stopLatched).toBe(true);

      // The failure was recorded, not silently dropped: one run's result carries it, and it was
      // emitted live as a `security` event with the same detail.
      expect(settled.some((r) => r.errors.some((e) => e.includes('kill EIO')))).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'security',
          kind: 'signal-failed',
          detail: expect.stringContaining('kill EIO'),
        })
      );

      sup.clearStop();
    } finally {
      killSpy.mockRestore();
    }
  });
});

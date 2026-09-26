import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
import { isTmuxServerLoss, TmuxServerSupervisor } from './tmux-server-supervisor';

/** One `tmux list-sessions` row, in the format the inventory parser expects. */
function row(name: string, serverPid: number | ''): string {
  return `${name}\t1700000000\t\t${serverPid}`;
}

/**
 * An exec runner whose tmux output is scripted per call, mirroring the runner shape the
 * runtime supplies. `undefined` stands for "the host had no execution context".
 */
function scriptedExec(outputs: (string | Error | 'no-context')[]) {
  const calls = { count: 0 };
  const run = async <T>(operation: (exec: IExecutionContext) => Promise<T>) => {
    const next = outputs[Math.min(calls.count, outputs.length - 1)];
    calls.count += 1;
    if (next === 'no-context') return undefined;
    const ctx = {
      exec: async () => {
        if (next instanceof Error) throw next;
        return { stdout: next, stderr: '', exitCode: 0 };
      },
    } as unknown as IExecutionContext;
    return await operation(ctx);
  };
  return { run, calls };
}

function noServerError(): Error {
  return Object.assign(new Error('exit 1'), {
    exitCode: 1,
    stderr: 'no server running on /tmp/tmux-501/ninebrains',
  });
}

describe('TmuxServerSupervisor', () => {
  it('announces the very first loss, because a spawn already told it the server was alive', async () => {
    const onServerChange = vi.fn();
    const exec = scriptedExec([noServerError()]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run, onServerChange });

    // The regression this locks in: recordSpawn used to only stash a generation, so the
    // watch never saw a running server and the first death was dropped on the floor —
    // three real sessions were lost in production with nothing reported at server level.
    supervisor.recordSpawn('agent', 1111, 'workspace-agent');

    const diagnosis = await supervisor.diagnose('agent');

    expect(diagnosis).toEqual({ kind: 'server-gone', previousServerPid: 1111 });
    expect(onServerChange).toHaveBeenCalledTimes(1);
    expect(onServerChange).toHaveBeenCalledWith({
      type: 'server-lost',
      previousServerPid: 1111,
      lostSessions: ['workspace-agent'],
    });
  });

  it('names every session that went down with the server, not just the one that exited', async () => {
    const onServerChange = vi.fn();
    const exec = scriptedExec([noServerError()]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run, onServerChange });
    supervisor.recordSpawn('a', 1111, 'workspace-a');
    supervisor.recordSpawn('b', 1111, 'workspace-b');

    await supervisor.diagnose('a');

    expect(onServerChange).toHaveBeenCalledWith(
      expect.objectContaining({ lostSessions: ['workspace-a', 'workspace-b'] })
    );
  });

  it('stops naming a session it was told to forget', async () => {
    const onServerChange = vi.fn();
    const exec = scriptedExec([noServerError()]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run, onServerChange });
    supervisor.recordSpawn('a', 1111, 'workspace-a');
    supervisor.recordSpawn('b', 1111, 'workspace-b');
    supervisor.forget('b');
    // Re-seed so the watch's session list reflects the removal.
    supervisor.recordSpawn('a', 1111, 'workspace-a');

    await supervisor.diagnose('a');

    expect(onServerChange).toHaveBeenCalledWith(
      expect.objectContaining({ lostSessions: ['workspace-a'] })
    );
  });

  it('reports a session that outlived its server as a loss, not a normal end', async () => {
    const exec = scriptedExec([row('agent', 4242)]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    // Spawned into server 1111; the live server is 4242, so the session was destroyed.
    supervisor.recordSpawn('agent', 1111);

    const diagnosis = await supervisor.diagnose('agent');

    expect(diagnosis).toEqual({
      kind: 'server-replaced',
      previousServerPid: 1111,
      serverPid: 4242,
    });
    expect(isTmuxServerLoss(diagnosis)).toBe(true);
  });

  it('reports a session that ended under its own server as finished', async () => {
    const exec = scriptedExec([row('agent', 1111)]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    supervisor.recordSpawn('agent', 1111);

    const diagnosis = await supervisor.diagnose('agent');

    expect(diagnosis).toEqual({ kind: 'session-ended' });
    expect(isTmuxServerLoss(diagnosis)).toBe(false);
  });

  it('reports a vanished server as a loss with no successor', async () => {
    const exec = scriptedExec([noServerError()]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    supervisor.recordSpawn('agent', 1111);

    const diagnosis = await supervisor.diagnose('agent');

    expect(diagnosis).toEqual({ kind: 'server-gone', previousServerPid: 1111 });
    expect(isTmuxServerLoss(diagnosis)).toBe(true);
  });

  it('never manufactures a loss when tmux cannot be reached', async () => {
    const exec = scriptedExec(['no-context']);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    supervisor.recordSpawn('agent', 1111);

    // A host with no execution context knows nothing; silence beats a false crash report.
    expect(await supervisor.diagnose('agent')).toEqual({ kind: 'unknown' });
  });

  it('never manufactures a loss for a session it never recorded', async () => {
    const exec = scriptedExec([row('other', 4242)]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });

    expect(await supervisor.diagnose('never-spawned')).toEqual({ kind: 'unknown' });
  });

  it('treats an unknown pid on either side as unknown rather than a replacement', async () => {
    const exec = scriptedExec([row('agent', '')]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    supervisor.recordSpawn('agent', 1111);

    expect(await supervisor.diagnose('agent')).toEqual({ kind: 'unknown' });
  });

  it('announces a server change once for the generation, not once per orphaned session', async () => {
    const onServerChange = vi.fn();
    let now = 1_000;
    // First probe sees generation 4242; every later probe sees 9999 — a replacement that
    // exits every session it hosted at the same moment.
    const exec = scriptedExec([row('agent', 4242), row('agent', 9999)]);
    const supervisor = new TmuxServerSupervisor({
      exec: exec.run,
      onServerChange,
      probeWindowMs: 250,
      now: () => now,
    });
    supervisor.recordSpawn('a', 4242);
    supervisor.recordSpawn('b', 4242);

    // Prime the watch with the generation the sessions were spawned into.
    await supervisor.diagnose('a');
    expect(onServerChange).not.toHaveBeenCalled();

    now += 500;
    const [first, second] = await Promise.all([supervisor.diagnose('a'), supervisor.diagnose('b')]);

    // Both sessions are correctly diagnosed as destroyed...
    expect(first).toMatchObject({ kind: 'server-replaced' });
    expect(second).toMatchObject({ kind: 'server-replaced' });
    // ...but the server death is reported once, not once per session.
    expect(onServerChange).toHaveBeenCalledTimes(1);
    expect(onServerChange).toHaveBeenCalledWith({
      type: 'server-restarted',
      previousServerPid: 4242,
      serverPid: 9999,
      lostSessions: ['agent'],
    });
  });

  it('shares one tmux probe across a burst of exits inside the coalescing window', async () => {
    const exec = scriptedExec([row('agent', 4242)]);
    let now = 1_000;
    const supervisor = new TmuxServerSupervisor({
      exec: exec.run,
      probeWindowMs: 250,
      now: () => now,
    });
    supervisor.recordSpawn('a', 1111);
    supervisor.recordSpawn('b', 1111);

    await Promise.all([supervisor.diagnose('a'), supervisor.diagnose('b')]);
    expect(exec.calls.count).toBe(1);

    // Past the window, a fresh probe is allowed.
    now += 500;
    await supervisor.diagnose('a');
    expect(exec.calls.count).toBe(2);
  });

  it('forgets a session so a recycled key cannot inherit a stale generation', async () => {
    const exec = scriptedExec([row('agent', 4242)]);
    const supervisor = new TmuxServerSupervisor({ exec: exec.run });
    supervisor.recordSpawn('agent', 1111);
    supervisor.forget('agent');

    expect(await supervisor.diagnose('agent')).toEqual({ kind: 'unknown' });
  });
});

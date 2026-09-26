import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
import { inspectTmuxSessions, type TmuxInventory } from './tmux-commands';
import { isTmuxSessionLoss, TmuxServerWatch } from './tmux-server-watch';

function stubExecContext(
  exec: (file: string, args?: string[]) => Promise<{ stdout: string; stderr: string }>
): IExecutionContext {
  return {
    root: '',
    supportsLocalSpawn: true,
    exec: exec as IExecutionContext['exec'],
    execStreaming: async () => ({ exitCode: 0 }),
    dispose: () => {},
  } as IExecutionContext;
}

function running(serverPid: number, names: readonly string[]): TmuxInventory {
  return {
    server: 'running',
    serverPid,
    sessions: names.map((name) => ({ name, activity: 0, identity: null, serverPid })),
  };
}

const ABSENT: TmuxInventory = { server: 'absent', serverPid: null, sessions: [] };
const UNAVAILABLE: TmuxInventory = { server: 'unavailable', serverPid: null, sessions: [] };

describe('inspectTmuxSessions', () => {
  it('reports the hosting server pid alongside the sessions', async () => {
    const exec = vi.fn(async () => ({ stdout: 'a\t42\t\t93738\nb\t43\t\t93738\n', stderr: '' }));

    await expect(inspectTmuxSessions(stubExecContext(exec))).resolves.toEqual({
      server: 'running',
      serverPid: 93_738,
      sessions: [
        { name: 'a', activity: 42_000, identity: null, serverPid: 93_738 },
        { name: 'b', activity: 43_000, identity: null, serverPid: 93_738 },
      ],
    });
  });

  it('distinguishes a dead server from a missing tmux binary', async () => {
    const dead = stubExecContext(async () => {
      throw { exitCode: 1, stderr: 'no server running on /private/tmp/tmux-501/default' };
    });
    const missing = stubExecContext(async () => {
      throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    });

    await expect(inspectTmuxSessions(dead)).resolves.toMatchObject({ server: 'absent' });
    await expect(inspectTmuxSessions(missing)).resolves.toMatchObject({ server: 'unavailable' });
  });

  it('still parses sessions from a server that will not report a pid', async () => {
    const exec = vi.fn(async () => ({ stdout: 'a\t42\t\t\n', stderr: '' }));

    await expect(inspectTmuxSessions(stubExecContext(exec))).resolves.toEqual({
      server: 'running',
      serverPid: null,
      sessions: [{ name: 'a', activity: 42_000, identity: null, serverPid: null }],
    });
  });

  it('rethrows failures that are not a missing server', async () => {
    const exec = stubExecContext(async () => {
      throw { exitCode: 1, stderr: 'permission denied' };
    });

    await expect(inspectTmuxSessions(exec)).rejects.toBeDefined();
  });
});

describe('TmuxServerWatch', () => {
  it('treats the first live server as a start, not a crash', () => {
    const watch = new TmuxServerWatch();

    expect(watch.observe(running(100, ['a']))).toEqual({
      type: 'server-started',
      serverPid: 100,
    });
  });

  it('stays silent while the same server keeps running', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['a']));

    expect(watch.observe(running(100, ['a', 'b']))).toBeNull();
    expect(watch.observe(running(100, ['a', 'b']))).toBeNull();
  });

  it('reports a restart the app never saw the gap of, naming the lost sessions', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['taxes', 'refactr']));

    const change = watch.observe(running(200, ['taxes']));

    expect(change).toEqual({
      type: 'server-restarted',
      previousServerPid: 100,
      serverPid: 200,
      lostSessions: ['taxes', 'refactr'],
    });
    expect(change && isTmuxSessionLoss(change)).toBe(true);
  });

  it('reports the death and the replacement as two transitions', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['taxes', 'refactr']));

    expect(watch.observe(ABSENT)).toEqual({
      type: 'server-lost',
      previousServerPid: 100,
      lostSessions: ['taxes', 'refactr'],
    });
    expect(watch.observe(running(200, ['taxes']))).toMatchObject({
      type: 'server-restarted',
      previousServerPid: 100,
      serverPid: 200,
    });
  });

  it('reports a death only once while the server stays gone', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['a']));

    expect(watch.observe(ABSENT)).toMatchObject({ type: 'server-lost' });
    expect(watch.observe(ABSENT)).toBeNull();
  });

  it('says nothing about a server it never saw running', () => {
    const watch = new TmuxServerWatch();

    expect(watch.observe(ABSENT)).toBeNull();
    expect(watch.observe(running(100, ['a']))).toEqual({
      type: 'server-started',
      serverPid: 100,
    });
  });

  it('never fabricates a restart from an unknown pid', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['a']));

    // A server that will not report its pid must not read as a replacement.
    expect(
      watch.observe({
        server: 'running',
        serverPid: null,
        sessions: [{ name: 'a', activity: 0, identity: null, serverPid: null }],
      })
    ).toBeNull();
    expect(watch.observe(running(100, ['a']))).toBeNull();
  });

  it('treats a missing tmux binary as absence of information, not a death', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['a']));

    expect(watch.observe(UNAVAILABLE)).toBeNull();
    // The remembered generation survives, so the next live observation still compares.
    expect(watch.snapshot()).toMatchObject({ serverPid: 100, running: true });
    expect(watch.observe(running(200, ['a']))).toMatchObject({ type: 'server-restarted' });
  });

  it('does not leak its internal session list to callers', () => {
    const watch = new TmuxServerWatch();
    watch.observe(running(100, ['a']));

    // The readonly type already forbids this at compile time; the cast is what lets the
    // test prove the defensive copy holds at runtime too.
    (watch.snapshot().sessionNames as string[]).push('mutated');

    expect(watch.snapshot().sessionNames).toEqual(['a']);
  });
});

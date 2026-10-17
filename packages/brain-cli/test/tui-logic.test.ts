import type { JobSummary, Lane } from '@ninebrains/brain-core';
import { describe, expect, it } from 'vitest';
import { completions, parseCommand } from '../src/tui/commands';
import { diffSnapshots, dispatchHint, laneLabel, type Snapshot } from '../src/tui/feed';

const job = (
  id: string,
  title: string,
  state: JobSummary['state'],
  extra: Partial<JobSummary> = {}
) => ({ id, title, state, laneId: null, attempts: 0, body: '', ...extra }) as JobSummary;
const lane = (id: string, status: Lane['status']): Lane => ({
  id,
  projectId: 'p1',
  provider: 'claude',
  status,
  recentFiles: [],
  activeJobId: null,
  updatedAt: 0,
});
const snap = (jobs: JobSummary[], lanes: Lane[], extra: Partial<Snapshot> = {}): Snapshot => ({
  jobs,
  lanes,
  paused: false,
  stopLatched: false,
  ...extra,
});

describe('feed', () => {
  it('reports nothing on the first poll, then each change once', () => {
    const first = snap([job('j1', 'fix auth', 'ready')], [lane('bdc0bee7', 'idle')]);
    expect(diffSnapshots(null, first)).toEqual([]);
    expect(diffSnapshots(first, first)).toEqual([]);

    const next = snap(
      [job('j1', 'fix auth', 'running', { laneId: 'bdc0bee7' }), job('j2', 'docs', 'ready')],
      [lane('bdc0bee7', 'running')]
    );
    expect(diffSnapshots(first, next)).toEqual([
      { tone: 'go', kind: 'job', text: 'fix auth  running → claude-bdc0' },
      { tone: 'info', kind: 'job', text: 'docs  created (ready)' },
      { tone: 'info', kind: 'lane', text: 'claude-bdc0  idle → running' },
    ]);
  });

  it('carries the block reason and the STOP latch', () => {
    const before = snap([job('j1', 'fix auth', 'running')], []);
    const after = snap([job('j1', 'fix auth', 'blocked', { reason: 'tests red' })], [], {
      stopLatched: true,
    });
    expect(diffSnapshots(before, after)).toEqual([
      { tone: 'fail', kind: 'brain', text: 'STOP latched: runs killed, dispatch halted' },
      { tone: 'warn', kind: 'job', text: 'fix auth  blocked: tests red' },
    ]);
  });

  it('says why a ready job is not moving', () => {
    const ready = [job('j1', 'check-running', 'ready')];
    expect(dispatchHint(snap([], []))).toBeNull();
    expect(dispatchHint(snap(ready, [lane('a', 'idle')]))).toBeNull();
    expect(dispatchHint(snap(ready, []))).toMatch(/^no lanes/);
    expect(dispatchHint(snap(ready, [lane('a', 'asleep')]))).toMatch(/^no live lane/);
    expect(dispatchHint(snap(ready, [lane('a', 'running')]))).toMatch(/^no idle lane/);
    expect(dispatchHint(snap(ready, [lane('a', 'idle')], { paused: true }))).toMatch(/paused/);
    expect(dispatchHint(snap(ready, [lane('a', 'idle')], { stopLatched: true }))).toMatch(/STOP/);
  });

  it('names a lane by provider and short id', () => {
    expect(laneLabel(lane('bdc0bee7-a6e1', 'idle'))).toBe('claude-bdc0');
  });
});

describe('commands', () => {
  const ctx = {
    jobs: [job('daebd67a-ea51', 'check-running', 'ready'), job('daeb0000-1111', 'docs', 'ready')],
    lanes: [lane('bdc0bee7-a6e1', 'idle')],
  };
  const parse = (line: string) => parseCommand(line, ctx);

  it('refuses plain text, so stray typing never acts', () => {
    expect(parse('n')).toEqual({ ok: false, error: expect.stringMatching(/start with \//) });
    expect(parse('q')).toMatchObject({ ok: false });
    expect(parse('')).toMatchObject({ ok: false });
  });

  it('parses /new with an optional body', () => {
    expect(parse('/new fix the flaky test')).toEqual({
      ok: true,
      action: { type: 'new', title: 'fix the flaky test' },
    });
    expect(parse('/new fix it -- see #12 for logs')).toEqual({
      ok: true,
      action: { type: 'new', title: 'fix it', body: 'see #12 for logs' },
    });
    expect(parse('/new')).toMatchObject({ ok: false });
  });

  it('resolves jobs and lanes by name or id prefix, and refuses ambiguity', () => {
    expect(parse('/assign check-running claude-bdc0')).toEqual({
      ok: true,
      action: { type: 'assign', jobId: 'daebd67a-ea51', laneId: 'bdc0bee7-a6e1' },
    });
    expect(parse('/requeue daebd6')).toEqual({
      ok: true,
      action: { type: 'requeue', jobId: 'daebd67a-ea51' },
    });
    expect(parse('/requeue daeb')).toEqual({ ok: false, error: '"daeb" matches 2 jobs' });
    expect(parse('/requeue dae')).toEqual({ ok: false, error: 'no job matches "dae"' });
  });

  it('parses /send to a lane or a Brain session', () => {
    expect(parse('/send claude-bdc0 rebase first')).toEqual({
      ok: true,
      action: { type: 'send', to: { kind: 'lane', id: 'bdc0bee7-a6e1' }, body: 'rebase first' },
    });
    expect(parse('/send brain:hub status?')).toEqual({
      ok: true,
      action: { type: 'send', to: { kind: 'brain', id: 'hub' }, body: 'status?' },
    });
  });

  it('needs a reason, a mode, a known command', () => {
    expect(parse('/block docs')).toEqual({ ok: false, error: '/block needs a reason' });
    expect(parse('/mode claude-bdc0 sometimes')).toMatchObject({ ok: false });
    expect(parse('/mode claude-bdc0 unattended')).toMatchObject({ ok: true });
    expect(parse('/frobnicate')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unknown/),
    });
    expect(parse('/jobs')).toEqual({ ok: true, action: { type: 'overlay', overlay: 'jobs' } });
    expect(parse('/clear-stop')).toEqual({ ok: true, action: { type: 'clear-stop' } });
  });

  it('completes command names until a space is typed', () => {
    expect(completions('/re').map((c) => c.name)).toEqual(['requeue', 'resume']);
    expect(completions('/requeue ')).toEqual([]);
    expect(completions('re')).toEqual([]);
  });
});

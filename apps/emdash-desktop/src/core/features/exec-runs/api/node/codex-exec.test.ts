import { describe, expect, it } from 'vitest';
import { buildCodexExecArgv, CodexEventParser } from './codex-exec';
import { totalTokens, type ExecRunSpec } from './types';

const spec = (over: Partial<ExecRunSpec> = {}): ExecRunSpec => ({
  runId: 'r1',
  provider: 'codex',
  preset: 'worker',
  cwd: '/wt',
  prompt: 'x',
  budgets: { wallClockMs: 1000 },
  ...over,
});

const parse = (events: object[]) => {
  const parser = new CodexEventParser();
  for (const e of events) parser.push(JSON.stringify(e));
  return parser.finish();
};

describe('codex exec argv (experimental)', () => {
  it('reads the prompt from stdin and never passes it in argv (SEC-17)', () => {
    const argv = buildCodexExecArgv(spec(), '/wt');
    expect(argv.at(-1)).toBe('-');
    expect(argv).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--json']));
  });

  it('uses the read-only sandbox for reviewers (SEC-18)', () => {
    const argv = buildCodexExecArgv(spec({ preset: 'reviewer' }), '/wt');
    expect(argv[argv.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('writes MCP servers as TOML -c overrides', () => {
    const argv = buildCodexExecArgv(
      spec({ mcpServers: { brain: { command: '/n', args: ['/b.js'], env: { LANE: 'a"b' } } } }),
      '/wt'
    );
    expect(argv).toContain('mcp_servers.brain.command="/n"');
    expect(argv).toContain('mcp_servers.brain.args=["/b.js"]');
    expect(argv).toContain('mcp_servers.brain.env={LANE="a\\"b"}');
  });

  it('rejects env keys that would inject TOML', () => {
    expect(() =>
      buildCodexExecArgv(spec({ mcpServers: { b: { command: '/n', env: { 'a=1,x': 'v' } } } }), '/wt')
    ).toThrow(/env key/);
  });
});

describe('codex exec event parser (experimental)', () => {
  it('reads a successful turn', () => {
    const outcome = parse([
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 } },
    ]);
    expect(outcome).toMatchObject({ sawResult: true, isError: false, text: 'done', sessionId: 't1' });
    expect(totalTokens(outcome.usage)).toBe(110);
  });

  it('treats the unauthenticated sequence seen in the spike as an error', () => {
    const outcome = parse([
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'error', message: 'Reconnecting... 1/5' },
      { type: 'item.completed', item: { id: 'e', type: 'error', message: 'stream error' } },
      { type: 'turn.failed', error: { message: 'unauthorized' } },
    ]);
    expect(outcome.isError).toBe(true);
    expect(outcome.errors).toContain('unauthorized');
  });

  it('treats a stream with no turn.completed as an error', () => {
    expect(parse([{ type: 'thread.started', thread_id: 't' }]).isError).toBe(true);
  });

  it('passes unknown events through without failing', () => {
    const parser = new CodexEventParser();
    expect(parser.push('{"type":"brand.new"}')[0]).toMatchObject({ kind: 'unknown' });
  });
});

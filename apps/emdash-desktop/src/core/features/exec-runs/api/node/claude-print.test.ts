import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildClaudeMcpConfig, buildClaudePrintArgv, ClaudeStreamParser } from './claude-print';
import { totalTokens, type AgentEvent, type ExecRunSpec } from './types';

const FIXTURES = fileURLToPath(
  new URL('../../../../../../../../tooling/fake-agent/fixtures/', import.meta.url)
);

function parseAll(lines: string[]) {
  const parser = new ClaudeStreamParser();
  const events: AgentEvent[] = lines.flatMap((l) => parser.push(l));
  return { parser, events, outcome: parser.finish() };
}

const fixture = (name: string) => readFileSync(FIXTURES + name, 'utf8').split('\n');

const spec = (over: Partial<ExecRunSpec> = {}): ExecRunSpec => ({
  runId: 'r1',
  provider: 'claude',
  preset: 'worker',
  cwd: '/wt',
  prompt: 'x',
  budgets: { wallClockMs: 1000 },
  ...over,
});
const files = { mcpConfigPath: '/d/mcp.json', settingsPath: '/d/s.json', sessionId: 'sid' };

describe('claude stream-json parser', () => {
  it('parses a real successful capture', () => {
    const { events, outcome } = parseAll(fixture('claude-p-ping.jsonl'));
    expect(events[0]).toMatchObject({ kind: 'init' });
    expect(events.some((e) => e.kind === 'tool-use')).toBe(true);
    expect(outcome).toMatchObject({ sawResult: true, isError: false });
    expect(outcome.text).toBeTypeOf('string');
    expect(totalTokens(outcome.usage)).toBeGreaterThan(0);
  });

  it('parses a real max-turns capture as an error with no result text', () => {
    const { outcome } = parseAll(fixture('claude-p-max-turns.jsonl'));
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toBeUndefined();
    expect(outcome.errors.join()).toMatch(/maximum number of turns/);
  });

  it('keys on is_error, not subtype: a logged-out "success" is an error (gotcha 15)', () => {
    const loggedOut = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      terminal_reason: 'api_error',
      result: 'Not logged in · Please run /login',
      usage: {},
    });
    const { events, outcome } = parseAll([loggedOut]);
    expect(events).toEqual([
      expect.objectContaining({ kind: 'result', isError: true, subtype: 'success' }),
    ]);
    expect(outcome).toMatchObject({ sawResult: true, isError: true });
  });

  it('counts a message once even when its usage repeats on every content block', () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const block = (id: string, text: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { id, content: [{ type: 'text', text }], usage },
      });
    const { parser } = parseAll([block('m1', 'a'), block('m1', 'b'), block('m2', 'c')]);
    expect(totalTokens(parser.usage())).toBe(30);
  });

  it('reports a missing result as sawResult false', () => {
    expect(parseAll(['{"type":"system","subtype":"init"}']).outcome.sawResult).toBe(false);
  });

  it('turns an unparseable line into an error event instead of throwing', () => {
    expect(parseAll(['not json']).events[0]).toMatchObject({ kind: 'error' });
  });
});

describe('claude argv builder', () => {
  it('uses --flag=value for every variadic flag and never a positional prompt (SEC-17)', () => {
    const argv = buildClaudePrintArgv(spec({ mcpServers: { brain: { command: '/n' } } }), files);
    expect(argv).toContain('--mcp-config=/d/mcp.json');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--permission-mode=dontAsk');
    expect(argv).toContain('--allowedTools=mcp__brain');
    // Every token is a flag: nothing positional can be read as the prompt.
    expect(argv.filter((t) => !t.startsWith('-'))).toEqual([]);
  });

  it('gives a reviewer Read/Grep/Glob only and removes shell and edit tools (SEC-18)', () => {
    const argv = buildClaudePrintArgv(spec({ preset: 'reviewer' }), files);
    expect(argv).toContain('--tools=Read,Grep,Glob');
    for (const tool of ['Bash', 'Edit', 'Write']) {
      expect(argv).toContain(`--disallowedTools=${tool}`);
      expect(argv).not.toContain(`--allowedTools=${tool}`);
    }
  });

  it('rejects an MCP server name that could break out of the tool pattern', () => {
    expect(() =>
      buildClaudePrintArgv(spec({ mcpServers: { 'a b': { command: '/n' } } }), files)
    ).toThrow(/server name/);
  });

  it('puts server env inside the server entry', () => {
    const cfg = JSON.parse(
      buildClaudeMcpConfig(spec({ mcpServers: { brain: { command: '/n', env: { LANE: 'a' } } } }))
    );
    expect(cfg.mcpServers.brain).toMatchObject({
      type: 'stdio',
      command: '/n',
      env: { LANE: 'a' },
    });
  });
});

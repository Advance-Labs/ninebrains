/**
 * `claude -p --output-format stream-json`: argv builder and stream parser.
 *
 * Launch recipe verified in docs/SPIKE-EXEC-PATHS.md §3:
 *   ENABLE_TOOL_SEARCH=false claude -p --output-format=stream-json --verbose
 *     --mcp-config=<f> --strict-mcp-config --settings=<f> --permission-mode=dontAsk ...
 * Every variadic flag is written `--flag=value`, one flag per value (§3.1: a bare
 * `--mcp-config <f>` swallows what follows). The prompt goes on stdin, never argv (SEC-17).
 */
import {
  emptyUsage,
  type AgentEvent,
  type AgentOutcome,
  type AgentStreamParser,
  type ExecRunSpec,
  type TokenUsage,
} from './types';

/** Built-in tools a reviewer may use (SEC-18). */
export const REVIEWER_TOOLS = ['Read', 'Grep', 'Glob'] as const;

/** Explicitly removed from a reviewer, in case `--tools` semantics change. */
export const REVIEWER_DENIED_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
] as const;

/** Default pre-approvals for an unattended worker (SEC-31 preset). Bash runs sandboxed. */
export const WORKER_DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Write',
  'Bash',
] as const;

export interface ClaudeArgvFiles {
  mcpConfigPath: string;
  settingsPath: string;
  sessionId: string;
}

const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function buildClaudePrintArgv(spec: ExecRunSpec, files: ClaudeArgvFiles): string[] {
  const mcpNames = Object.keys(spec.mcpServers ?? {});
  for (const name of mcpNames) {
    if (!SERVER_NAME.test(name)) throw new Error(`Unsafe MCP server name: ${JSON.stringify(name)}`);
  }
  const argv = [
    '-p',
    '--output-format=stream-json',
    '--verbose',
    `--mcp-config=${files.mcpConfigPath}`,
    '--strict-mcp-config',
    `--settings=${files.settingsPath}`,
    '--permission-mode=dontAsk',
    '--permission-prompts=none',
    `--session-id=${files.sessionId}`,
  ];
  const mcpAllow = mcpNames.map((name) => `mcp__${name}`);
  if (spec.preset === 'reviewer') {
    argv.push(`--tools=${REVIEWER_TOOLS.join(',')}`);
    for (const tool of [...REVIEWER_TOOLS, ...mcpAllow]) argv.push(`--allowedTools=${tool}`);
    for (const tool of REVIEWER_DENIED_TOOLS) argv.push(`--disallowedTools=${tool}`);
  } else {
    const allowed = spec.allowedTools ?? [...WORKER_DEFAULT_ALLOWED_TOOLS, ...mcpAllow];
    for (const tool of allowed) argv.push(`--allowedTools=${tool}`);
  }
  if (spec.budgets.maxTurns !== undefined) argv.push(`--max-turns=${spec.budgets.maxTurns}`);
  if (spec.budgets.maxBudgetUsd !== undefined) {
    argv.push(`--max-budget-usd=${spec.budgets.maxBudgetUsd}`);
  }
  if (spec.model) argv.push(`--model=${spec.model}`);
  if (spec.appendSystemPrompt) argv.push(`--append-system-prompt=${spec.appendSystemPrompt}`);
  return argv;
}

/**
 * `--mcp-config` file body. Lane identity travels in each server's own env (spike §4). Claude's
 * config takes `"type": "http"` servers too (the SEO pack's remote servers), with their headers.
 */
export function buildClaudeMcpConfig(spec: ExecRunSpec): string {
  const mcpServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(spec.mcpServers ?? {})) {
    mcpServers[name] =
      server.type === 'http'
        ? { type: 'http', url: server.url, headers: { ...server.headers }, alwaysLoad: true }
        : {
            type: 'stdio',
            command: server.command,
            args: [...(server.args ?? [])],
            env: { ...server.env },
            alwaysLoad: true,
          };
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function toTokenUsage(raw: unknown): TokenUsage {
  const u = asObject(raw) ?? {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
  };
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
});

/**
 * Parses stream-json lines. Success is decided by `result.is_error` and the exit code, never by
 * `subtype`: a logged-out account emits `subtype: "success"` with `is_error: true` (gotcha 15).
 */
export class ClaudeStreamParser implements AgentStreamParser {
  /** Usage per assistant message id; the CLI repeats a message's usage on each content block. */
  private readonly perMessage = new Map<string, TokenUsage>();
  private finalUsage?: TokenUsage;
  private outcome: AgentOutcome = {
    sawResult: false,
    isError: false,
    errors: [],
    usage: emptyUsage(),
    permissionDenials: [],
  };

  push(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let msg: Json | undefined;
    try {
      msg = asObject(JSON.parse(trimmed));
    } catch {
      return [{ kind: 'error', message: `Unparseable stream line: ${trimmed.slice(0, 200)}` }];
    }
    if (!msg) return [{ kind: 'unknown', raw: trimmed }];
    switch (msg.type) {
      case 'system':
        return msg.subtype === 'init' ? [this.onInit(msg)] : [{ kind: 'unknown', raw: msg }];
      case 'rate_limit_event':
        return [{ kind: 'rate-limit', info: msg.rate_limit_info }];
      case 'assistant':
        return this.onAssistant(msg);
      case 'user':
        return this.onUser(msg);
      case 'result':
        return [this.onResult(msg)];
      default:
        return [{ kind: 'unknown', raw: msg }];
    }
  }

  usage(): TokenUsage {
    if (this.finalUsage) return this.finalUsage;
    return [...this.perMessage.values()].reduce(addUsage, emptyUsage());
  }

  finish(): AgentOutcome {
    return { ...this.outcome, usage: this.usage() };
  }

  private onInit(msg: Json): AgentEvent {
    const sessionId = typeof msg.session_id === 'string' ? msg.session_id : undefined;
    this.outcome.sessionId = sessionId;
    return {
      kind: 'init',
      sessionId,
      model: typeof msg.model === 'string' ? msg.model : undefined,
      version: typeof msg.claude_code_version === 'string' ? msg.claude_code_version : undefined,
      tools: Array.isArray(msg.tools) ? msg.tools.filter((t) => typeof t === 'string') : undefined,
    };
  }

  private onAssistant(msg: Json): AgentEvent[] {
    const message = asObject(msg.message) ?? {};
    const events: AgentEvent[] = [];
    const id = typeof message.id === 'string' ? message.id : `anon-${this.perMessage.size}`;
    if (message.usage) {
      this.perMessage.set(id, toTokenUsage(message.usage));
      events.push({ kind: 'usage', usage: this.usage() });
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const b = asObject(block);
      if (b?.type === 'text' && typeof b.text === 'string')
        events.push({ kind: 'text', text: b.text });
      if (b?.type === 'tool_use') {
        events.push({ kind: 'tool-use', id: String(b.id), name: String(b.name), input: b.input });
      }
    }
    return events;
  }

  private onUser(msg: Json): AgentEvent[] {
    const content = asObject(msg.message)?.content;
    return (Array.isArray(content) ? content : [])
      .map(asObject)
      .filter((b): b is Json => b?.type === 'tool_result')
      .map((b) => ({
        kind: 'tool-result',
        toolUseId: String(b.tool_use_id),
        isError: b.is_error === true,
      }));
  }

  private onResult(msg: Json): AgentEvent {
    const errors = Array.isArray(msg.errors) ? msg.errors.map(String) : [];
    const text = typeof msg.result === 'string' ? msg.result : undefined;
    const isError = msg.is_error === true;
    if (msg.usage) this.finalUsage = toTokenUsage(msg.usage);
    this.outcome = {
      ...this.outcome,
      sawResult: true,
      isError,
      text,
      errors,
      costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
      numTurns: typeof msg.num_turns === 'number' ? msg.num_turns : undefined,
      sessionId: typeof msg.session_id === 'string' ? msg.session_id : this.outcome.sessionId,
      permissionDenials: Array.isArray(msg.permission_denials) ? msg.permission_denials : [],
    };
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : undefined;
    return { kind: 'result', isError, subtype, text, errors };
  }
}

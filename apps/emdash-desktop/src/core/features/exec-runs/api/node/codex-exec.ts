/**
 * EXPERIMENTAL. `codex exec --json`: argv builder and event parser.
 *
 * Only verified up to the auth boundary (docs/SPIKE-EXEC-PATHS.md §8): `thread.started`,
 * `turn.started`, `error`, `item.completed` (error) and `turn.failed` were seen; the rest of the
 * shape comes from the @openai/codex-sdk 0.154.0 types. The parser is defensive: unknown events
 * pass through as `unknown`, and a run counts as successful only with `turn.completed`, no
 * `turn.failed` or `error`, and exit code 0.
 *
 * Isolation is weaker than Claude's: `--sandbox` restricts writes and network, not reads, so a
 * Codex run can read sibling lanes' files (threat model accepted risk R2).
 */
import {
  emptyUsage,
  type AgentEvent,
  type AgentOutcome,
  type AgentStreamParser,
  type ExecRunSpec,
  type TokenUsage,
} from './types';

const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** A TOML basic string. JSON escaping is a valid subset of TOML's for the characters we emit. */
const tomlString = (value: string): string => JSON.stringify(value);

/** `-c` override values (without the `-c`) for the run's MCP servers. */
function mcpOverrides(spec: ExecRunSpec): string[] {
  const out: string[] = [];
  for (const [name, server] of Object.entries(spec.mcpServers ?? {})) {
    if (!SERVER_NAME.test(name)) throw new Error(`Unsafe MCP server name: ${JSON.stringify(name)}`);
    if (server.type === 'http') {
      throw new Error(`Codex runs take stdio MCP servers only; "${name}" is an http server`);
    }
    out.push(`mcp_servers.${name}.command=${tomlString(server.command)}`);
    out.push(`mcp_servers.${name}.args=[${(server.args ?? []).map(tomlString).join(',')}]`);
    const env = Object.entries(server.env ?? {});
    for (const [key] of env) {
      if (!ENV_KEY.test(key)) throw new Error(`Unsafe MCP env key: ${JSON.stringify(key)}`);
    }
    if (env.length) {
      out.push(
        `mcp_servers.${name}.env={${env.map(([k, v]) => `${k}=${tomlString(v)}`).join(',')}}`
      );
    }
  }
  return out;
}

/**
 * The argv plus the `-c` overrides this builder generated. The SEC-12 guard refuses any `-c`
 * value not in `trusted`, so an override injected from elsewhere never reaches Codex.
 * The trailing `-` reads the prompt from stdin (SEC-17), per `codex exec --help`.
 */
export function buildCodexExecLaunch(
  spec: ExecRunSpec,
  cwd: string
): { argv: string[]; trusted: string[] } {
  const config = ['approval_policy="never"', ...mcpOverrides(spec)];
  return {
    argv: [
      'exec',
      '--json',
      '--cd',
      cwd,
      '--sandbox',
      spec.preset === 'reviewer' ? 'read-only' : 'workspace-write',
      ...config.flatMap((value) => ['-c', value]),
      ...(spec.model ? ['--model', spec.model] : []),
      '-',
    ],
    trusted: config,
  };
}

export function buildCodexExecArgv(spec: ExecRunSpec, cwd: string): string[] {
  return buildCodexExecLaunch(spec, cwd).argv;
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class CodexEventParser implements AgentStreamParser {
  private total: TokenUsage = emptyUsage();
  private lastText?: string;
  private threadId?: string;
  private completed = false;
  private failed = false;
  private readonly errors: string[] = [];

  push(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let msg: Json | undefined;
    try {
      msg = asObject(JSON.parse(trimmed));
    } catch {
      return [{ kind: 'error', message: `Unparseable event line: ${trimmed.slice(0, 200)}` }];
    }
    if (!msg) return [{ kind: 'unknown', raw: trimmed }];
    switch (msg.type) {
      case 'thread.started':
        this.threadId = typeof msg.thread_id === 'string' ? msg.thread_id : undefined;
        return [{ kind: 'init', sessionId: this.threadId }];
      case 'item.started':
      case 'item.updated':
        return [];
      case 'item.completed':
        return this.onItem(asObject(msg.item) ?? {});
      case 'turn.completed': {
        const u = asObject(msg.usage) ?? {};
        // Codex reports cached input inside input_tokens; split it out so totals don't double count.
        const cached = num(u.cached_input_tokens);
        this.total = {
          inputTokens: this.total.inputTokens + Math.max(0, num(u.input_tokens) - cached),
          outputTokens: this.total.outputTokens + num(u.output_tokens),
          cacheCreationInputTokens: this.total.cacheCreationInputTokens,
          cacheReadInputTokens: this.total.cacheReadInputTokens + cached,
        };
        this.completed = true;
        return [{ kind: 'usage', usage: this.total }];
      }
      case 'turn.failed': {
        this.failed = true;
        const message = String(asObject(msg.error)?.message ?? 'turn failed');
        this.errors.push(message);
        return [{ kind: 'result', isError: true, subtype: 'turn.failed', errors: [message] }];
      }
      case 'error': {
        this.failed = true;
        const message = String(msg.message ?? 'error');
        this.errors.push(message);
        return [{ kind: 'error', message }];
      }
      default:
        return [{ kind: 'unknown', raw: msg }];
    }
  }

  usage(): TokenUsage {
    return this.total;
  }

  finish(): AgentOutcome {
    return {
      sawResult: this.completed || this.failed,
      isError: this.failed || !this.completed,
      text: this.lastText,
      errors: [...this.errors],
      usage: this.total,
      sessionId: this.threadId,
      permissionDenials: [],
    };
  }

  private onItem(item: Json): AgentEvent[] {
    const type = String(item.type ?? 'unknown');
    if (type === 'agent_message' && typeof item.text === 'string') {
      this.lastText = item.text;
      return [{ kind: 'text', text: item.text }];
    }
    if (type === 'error') {
      const message = String(item.message ?? 'item error');
      this.errors.push(message);
      return [{ kind: 'error', message }];
    }
    if (type === 'reasoning') return [];
    return [{ kind: 'tool-use', id: String(item.id ?? ''), name: type, input: item }];
  }
}

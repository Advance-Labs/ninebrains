// Builders for `claude -p --output-format stream-json --verbose` events. Field
// names and nesting follow the real samples in fixtures/ (Claude Code 2.1.267).
// Only fields a consumer is likely to read are reproduced.
import { randomUUID } from 'node:crypto';

export const FAKE_VERSION = '0.0.0-fake';

const MODEL_ALIASES = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  fable: 'claude-fable-5-1',
};
export const resolveModel = (m) => MODEL_ALIASES[m] ?? m ?? 'claude-sonnet-5';

// FAKE_AGENT_USAGE (e.g. {"output_tokens":400}) overrides the per-message usage
// so token-budget tests have something to count. Read at call time.
const zeroUsage = () => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  ...(process.env.FAKE_AGENT_USAGE ? JSON.parse(process.env.FAKE_AGENT_USAGE) : {}),
});

export function initEvent({ cwd, sessionId, tools, mcpServers, model, permissionMode }) {
  return {
    type: 'system',
    subtype: 'init',
    cwd,
    session_id: sessionId,
    tools,
    mcp_servers: mcpServers,
    model,
    permissionMode,
    slash_commands: [],
    // As the real CLI (docs/SPIKE-EXEC-PATHS.md §13): a login or ANTHROPIC_AUTH_TOKEN reports "none".
    apiKeySource: process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'none',
    claude_code_version: FAKE_VERSION,
    output_style: 'default',
    agents: [],
    skills: [],
    plugins: [],
    uuid: randomUUID(),
  };
}

export function rateLimitEvent(sessionId, windows) {
  const unifiedWindows = Object.fromEntries(
    Object.entries(windows).map(([k, utilization]) => [k, { utilization, resetsAt: Math.floor(Date.now() / 1000) + 3600 }])
  );
  return {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', isUsingOverage: false, unifiedWindows },
    uuid: randomUUID(),
    session_id: sessionId,
  };
}

export function assistantEvent(sessionId, model, block) {
  return {
    type: 'assistant',
    message: {
      model,
      id: `msg_fake_${randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      content: [block],
      stop_reason: null,
      stop_sequence: null,
      usage: zeroUsage(),
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export function toolResultEvent(sessionId, toolUseId, content, isError, toolUseResult) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content, is_error: isError }] },
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    tool_use_result: toolUseResult ?? content,
  };
}

// Success results carry `result`; error results (e.g. error_max_turns) carry an
// `errors` array and no `result` key, as in fixtures/claude-p-max-turns.jsonl.
export function resultEvent({ sessionId, subtype = 'success', result, errors, numTurns, startedAt, denials, terminalReason, stopReason }) {
  const isError = subtype !== 'success';
  return {
    type: 'result',
    subtype,
    is_error: isError,
    duration_ms: Date.now() - startedAt,
    duration_api_ms: 0,
    num_turns: numTurns,
    ...(isError ? { errors: errors ?? [] } : { result: result ?? '' }),
    stop_reason: stopReason ?? (isError ? null : 'end_turn'),
    session_id: sessionId,
    total_cost_usd: 0,
    usage: zeroUsage(),
    modelUsage: {},
    permission_denials: denials,
    terminal_reason: terminalReason ?? (isError ? subtype : 'completed'),
    uuid: randomUUID(),
  };
}

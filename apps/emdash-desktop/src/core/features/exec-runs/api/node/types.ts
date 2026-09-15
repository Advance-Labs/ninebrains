/**
 * Shared types for unattended agent runs (`claude -p`, `codex exec`).
 *
 * Everything here is data. The supervisor, the argv builders and the stream parsers live in
 * sibling files so the gates slice can import them through this `api/node` surface.
 */
import type { LaunchRouting } from '@core/features/routing/api/node/launch-env';

export type ExecProvider = 'claude' | 'codex';

/**
 * `worker`: an unattended lane run that may edit its own worktree inside the sandbox.
 * `reviewer`: a read-only run (SEC-18): Read/Grep/Glob only, no shell, no writes.
 */
export type ExecPreset = 'worker' | 'reviewer';

/** One MCP server for a run. Claude takes both kinds; Codex runs take stdio servers only. */
export type McpServerSpec =
  | {
      type?: 'stdio';
      command: string;
      args?: readonly string[];
      env?: Readonly<Record<string, string>>;
    }
  | { type: 'http'; url: string; headers?: Readonly<Record<string, string>> };

export interface RunBudgets {
  /** Hard wall-clock limit. The supervisor kills the process group when it passes. */
  wallClockMs: number;
  /** Total tokens (input + output + cache creation + cache read), counted from stream usage. */
  maxTokens?: number;
  /** Passed to the CLI as `--max-turns` (Claude only). */
  maxTurns?: number;
  /** Passed to the CLI as `--max-budget-usd` (Claude only). */
  maxBudgetUsd?: number;
}

/** Account and auth selection. Only these reach the child env (SEC-13). */
export interface ProviderAuthEnv {
  CLAUDE_CONFIG_DIR?: string;
  CODEX_HOME?: string;
  /** Only when the user chose API-key mode for this account. */
  ANTHROPIC_API_KEY?: string;
}

export interface ExecRunSpec {
  /** Must be a safe path segment (SEC-14); it names the transcript file. */
  runId: string;
  provider: ExecProvider;
  preset: ExecPreset;
  /** Worktree (worker) or disposable review checkout (reviewer). Validated before spawn (SEC-31). */
  cwd: string;
  /** Sent on stdin, never argv (SEC-17). */
  prompt: string;
  budgets: RunBudgets;
  model?: string;
  appendSystemPrompt?: string;
  mcpServers?: Readonly<Record<string, McpServerSpec>>;
  /** Worker preset only: overrides the default tool pre-approval list. */
  allowedTools?: readonly string[];
  /** Other lanes' worktrees, denied for reading (SEC-11). */
  siblingWorktrees?: readonly string[];
  /** Sandbox network egress allowlist for Claude runs (SEC-32). Omitted: CLI default. */
  egressAllowedDomains?: readonly string[];
  auth?: ProviderAuthEnv;
  /**
   * The model route (`routing/api/node/launch-env`): the subscription (default) or a model
   * profile, plus Lever A's subagent tier. The supervisor turns it into env and Codex config and
   * checks SEC-39 on the result. Reviewers never set it (use `reviewerRoute` instead); the
   * supervisor refuses a `reviewer` preset spec that carries this field.
   */
  routing?: LaunchRouting;
  /**
   * The reviewer's own model route (SEC-42), a separate field from `routing` on purpose: no job,
   * lane, Brain MCP op or worktree file can reach it, only the reviewer spawn path
   * (`gates/node/capabilities/spawn-reviewer.ts`, driven by `reviewer-route.ts`'s pinned-profile
   * setting). Undefined runs the reviewer on the user's subscription, exactly as before this
   * field existed. The supervisor refuses a non-`reviewer` preset spec that carries it.
   */
  reviewerRoute?: LaunchRouting;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
});

export const totalTokens = (u: TokenUsage): number =>
  u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;

/** Provider-neutral view of one stream event. */
export type AgentEvent =
  | {
      kind: 'init';
      sessionId?: string;
      model?: string;
      version?: string;
      tools?: string[];
      /** Claude: which credential the CLI resolved (`none` for a login or a gateway token). */
      apiKeySource?: string;
    }
  | { kind: 'text'; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; toolUseId: string; isError: boolean }
  | { kind: 'usage'; usage: TokenUsage }
  | { kind: 'rate-limit'; info: unknown }
  | { kind: 'result'; isError: boolean; subtype?: string; text?: string; errors: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'unknown'; raw: unknown };

/** What a parser concluded once the process has exited. */
export interface AgentOutcome {
  /** True when the stream carried a terminal result (Claude `result`, Codex `turn.completed`). */
  sawResult: boolean;
  isError: boolean;
  text?: string;
  errors: string[];
  usage: TokenUsage;
  costUsd?: number;
  numTurns?: number;
  sessionId?: string;
  permissionDenials: unknown[];
}

export interface AgentStreamParser {
  /** Feed one stdout line; returns the events it produced (possibly none). */
  push(line: string): AgentEvent[];
  /** Cumulative usage so far, for live token budgets. */
  usage(): TokenUsage;
  finish(): AgentOutcome;
}

export type ExecRunEndReason =
  | 'completed'
  | 'agent-error'
  | 'exit-nonzero'
  | 'no-result'
  | 'wall-clock'
  | 'tokens'
  | 'cancelled'
  | 'killed'
  | 'spawn-failed'
  /** SEC-41: the CLI's init event named another credential or model than the route. */
  | 'credential-mismatch';

export interface ExecRunResult {
  runId: string;
  /** `exitCode === 0`, a terminal result was seen, `is_error` false, no budget or kill. */
  ok: boolean;
  reason: ExecRunEndReason;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  isError: boolean;
  text?: string;
  errors: string[];
  usage: TokenUsage;
  totalTokens: number;
  costUsd?: number;
  transcriptPath: string;
  durationMs: number;
}

export type ExecRunEvent =
  | { type: 'started'; runId: string; provider: ExecProvider; preset: ExecPreset; pid: number }
  | { type: 'agent'; runId: string; event: AgentEvent }
  | { type: 'budget-exceeded'; runId: string; budget: 'wall-clock' | 'tokens' }
  /** A security-relevant refusal, for `security_events` once SEC-33 lands (logged until then).
   * `signal-failed`: a SEC-30 kill signal (the post-close reap, or one of `killAll`'s/the
   * wall-clock timeout's SIGTERM/SIGKILLs) failed for a reason `signalGroup` doesn't already
   * treat as "the group is gone" (ESRCH/EPERM never reach here). */
  | {
      type: 'security';
      runId: string;
      kind: 'credential-mismatch' | 'signal-failed';
      detail: string;
    }
  | { type: 'finished'; runId: string; result: ExecRunResult }
  | { type: 'stop-latched'; activeRuns: number }
  | { type: 'stop-cleared' };

/** Resolves a provider CLI to an absolute path, never via the worktree or cwd (SEC-16). */
export type ResolveProviderBinary = (provider: ExecProvider) => Promise<string>;

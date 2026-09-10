/**
 * Structural copies of the `@emdash/gates-core` capability contracts (packages/gates-core/src/
 * types.ts, as of 18fcedfbe). The desktop app does not depend on that package yet; once the
 * integrator adds it, replace this file with `import type { ... } from '@emdash/gates-core'`.
 * The shapes must stay identical: gates-core only ever grows by optional fields.
 */

export type JobKind = 'code' | 'ui' | 'research' | 'seo' | 'docs';

export interface GateJob {
  id: string;
  title: string;
  body: string;
  kind: JobKind;
  attempt: number;
  baseRef?: string;
  artifacts?: string[];
}

export interface Evidence {
  kind: 'screenshot' | 'log' | 'diff' | 'json' | 'text';
  path: string;
  label: string;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/** Without `argv`, `command` is a shell line. With `argv`, `command` is the executable. */
export type RunCommand = (
  command: string,
  opts: { cwd: string; signal: AbortSignal; timeoutMs?: number; argv?: readonly string[] }
) => Promise<CommandResult>;

export interface SpawnReviewerOptions {
  signal: AbortSignal;
  /** A disposable review checkout from `prepareReviewCheckout`, never the lane worktree. */
  cwd: string;
  tools: 'read-only';
  attachments: Evidence[];
  purpose: string;
  /** Planned additive field (gates-core README) for the SEO red-team gate. */
  mcpServers?: Readonly<Record<string, ReviewerMcpServer>>;
}

export interface ReviewerMcpServer {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export type SpawnReviewer = (prompt: string, opts: SpawnReviewerOptions) => Promise<{ text: string }>;

export interface ReviewCheckout {
  path: string;
  dispose(): Promise<void>;
}

export type PrepareReviewCheckout = (
  job: GateJob,
  opts: { signal: AbortSignal }
) => Promise<ReviewCheckout>;

/** `@emdash/citations` FetchText. */
export type FetchText = (url: string, init: { signal?: AbortSignal }) => Promise<string>;

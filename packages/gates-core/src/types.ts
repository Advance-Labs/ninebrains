/**
 * Gate contracts.
 *
 * Gates depend only on the interfaces in this file. Everything that touches the
 * outside world (a browser, a shell, a second agent, the network, the
 * worktree's files) arrives as an injected capability, so the app decides how
 * each is sandboxed and tests can mock every one.
 */

import type { FetchText } from '@emdash/citations';

export type JobKind = 'code' | 'ui' | 'research' | 'seo' | 'docs';

export interface GateJob {
  id: string;
  title: string;
  body: string;
  kind: JobKind;
  /** 1-based attempt number being verified. */
  attempt: number;
  /** Commit the lane started from; reviewers diff against it. Defaults to HEAD. */
  baseRef?: string;
  /** Worktree-relative paths the worker reported with complete_job. */
  artifacts?: string[];
}

export type EvidenceKind = 'screenshot' | 'log' | 'diff' | 'json' | 'text';

export interface Evidence {
  kind: EvidenceKind;
  /** Absolute path of the stored file. */
  path: string;
  label: string;
}

export interface GateResult {
  pass: boolean;
  evidence: Evidence[];
  /** Written for the worker agent: what failed and what to change. */
  feedback: string;
  metrics?: Record<string, number>;
}

/**
 * Thrown by a capability when a gate could not reach a verdict about the
 * agent's work because of an environment precondition — DevTools open on the
 * lane browser, another debugger attached, and the like. This is never the
 * worker's to fix by changing code, so a gate that catches it must not report
 * an ordinary failure: the app's gate runner treats it like a setup problem
 * (SEC-20's `configurationError` metric) and does not spend a self-heal
 * attempt on it.
 */
export class GatePreconditionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GatePreconditionError';
  }
}

export interface Viewport {
  label: string;
  width: number;
  height: number;
}

export interface FailedRequest {
  url: string;
  status?: number;
  error?: string;
}

export interface ScreenshotCapture {
  png: Uint8Array;
  consoleErrors: string[];
  failedRequests: FailedRequest[];
}

export type CaptureScreenshot = (
  viewport: Viewport,
  opts: { url: string; signal: AbortSignal }
) => Promise<ScreenshotCapture>;

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

/**
 * Runs a command in `cwd`. Without `argv`, `command` is a shell line. With
 * `argv`, `command` is the executable and nothing goes through a shell (the
 * reviewer's git calls always use this).
 *
 * SEC-20: the tests gate runs lane-controlled scripts through this, so the app
 * must run it under the lane sandbox with a scrubbed env (no NINEBRAINS_*, pack
 * secrets or provider keys), kill the whole process group on abort or timeout,
 * and cap output at 1 MiB.
 */
export type RunCommand = (
  command: string,
  opts: { cwd: string; signal: AbortSignal; timeoutMs?: number; argv?: readonly string[] }
) => Promise<CommandResult>;

/**
 * Final contract for the app. It only ever grows by OPTIONAL fields, which is
 * not a breaking change for implementations or callers. Planned: `mcpServers`,
 * for the SEO red-team gate. An implementation that cannot honour an option
 * that is set must throw rather than ignore it.
 */
export interface SpawnReviewerOptions {
  signal: AbortSignal;
  /**
   * A disposable review checkout from `prepareReviewCheckout` (SEC-18). Never
   * the lane worktree: the reviewer must not be able to touch what it grades.
   */
  cwd: string;
  /**
   * Read/Grep/Glob only: no Bash, no writes, no network (SEC-18). The reviewer
   * never runs tests; the tests gate does, and its log arrives as evidence.
   */
  tools: 'read-only';
  attachments: Evidence[];
  /** Which gate is asking, for routing (e.g. a different model for security review). */
  purpose: string;
}

/** Starts an independent reviewer run and returns its final reply. */
export type SpawnReviewer = (
  prompt: string,
  opts: SpawnReviewerOptions
) => Promise<{ text: string }>;

export interface ReviewCheckout {
  /** Absolute path of the checkout. */
  path: string;
  /** Deletes the checkout. Gates call it however the review ends. */
  dispose(): Promise<void>;
}

/**
 * Makes a disposable, detached checkout of the job's result in a temp dir
 * (`git worktree add --detach <tmp> <commit>`, with untracked files copied in),
 * so a reviewer can read the work without any path into the lane worktree
 * (SEC-18).
 */
export type PrepareReviewCheckout = (
  job: GateJob,
  opts: { signal: AbortSignal }
) => Promise<ReviewCheckout>;

/** Reads a worktree-relative file. The app must confine it to the worktree. */
export type ReadWorktreeFile = (
  relativePath: string,
  opts: { signal: AbortSignal }
) => Promise<string>;

export interface GateCapabilities {
  captureScreenshot: CaptureScreenshot;
  runCommand: RunCommand;
  spawnReviewer: SpawnReviewer;
  prepareReviewCheckout: PrepareReviewCheckout;
  fetchText: FetchText;
  readWorktreeFile: ReadWorktreeFile;
}

export interface EvidenceInput {
  kind: EvidenceKind;
  label: string;
  /** Suggested file name. It is sanitised; never trusted as a path. */
  fileName: string;
  data: string | Uint8Array;
}

export interface EvidenceStore {
  /** Absolute directory for this job attempt. */
  readonly dir: string;
  put(input: EvidenceInput): Promise<Evidence>;
  list(): Evidence[];
}

export interface GateContext {
  job: GateJob;
  worktreePath: string;
  previewUrl?: string;
  evidence: EvidenceStore;
  signal: AbortSignal;
  capabilities: GateCapabilities;
}

export interface Gate {
  id: string;
  title: string;
  appliesTo(job: GateJob): boolean;
  run(ctx: GateContext): Promise<GateResult>;
}

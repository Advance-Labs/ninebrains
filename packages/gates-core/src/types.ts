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

/** Runs a shell command line. The app owns quoting, sandboxing and process cleanup. */
export type RunCommand = (
  command: string,
  opts: { cwd: string; signal: AbortSignal; timeoutMs?: number }
) => Promise<CommandResult>;

/**
 * Final contract for the app. It only ever grows by OPTIONAL fields, which is
 * not a breaking change for implementations or callers. Planned: `mcpServers`,
 * for the SEO red-team gate. An implementation that cannot honour an option
 * that is set must throw rather than ignore it.
 */
export interface SpawnReviewerOptions {
  signal: AbortSignal;
  cwd: string;
  /** Always true: a reviewer must never write to the worktree it is judging. */
  readOnly: true;
  attachments: Evidence[];
  /** Which gate is asking, for routing (e.g. a different model for security review). */
  purpose: string;
}

/** Starts an independent reviewer run and returns its final reply. */
export type SpawnReviewer = (
  prompt: string,
  opts: SpawnReviewerOptions
) => Promise<{ text: string }>;

/** Reads a worktree-relative file. The app must confine it to the worktree. */
export type ReadWorktreeFile = (
  relativePath: string,
  opts: { signal: AbortSignal }
) => Promise<string>;

export interface GateCapabilities {
  captureScreenshot: CaptureScreenshot;
  runCommand: RunCommand;
  spawnReviewer: SpawnReviewer;
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

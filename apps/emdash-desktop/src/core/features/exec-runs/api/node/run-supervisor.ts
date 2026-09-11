/**
 * Run supervisor for unattended agent runs, owned by main. Budgets are enforced here, not by
 * the agent (SEC-29): wall clock, tokens from stream usage, and a global cap on concurrent runs.
 * `killAll()` is the global STOP (SEC-30): it latches, SIGTERMs every run's process group and
 * SIGKILLs it at 2 s, so everything is gone well inside 5 s.
 *
 * Persisting budget counters across an app restart (the rest of SEC-29) belongs to the Brain DB
 * owner; this class emits every counter change as an event for that store to record.
 */
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { buildClaudeMcpConfig, buildClaudePrintArgv, ClaudeStreamParser } from './claude-print';
import { buildCodexExecArgv, CodexEventParser } from './codex-exec';
import { signalGroup, spawnInGroup, terminateGroup } from './process-group';
import { createRedactor, describeEnvForTranscript } from './redact';
import { buildUnattendedEnv } from './run-env';
import { ensurePrivateDir, ninebrainsDir, resolveRunCwd, runPaths } from './run-paths';
import { buildClaudeSandboxSettings } from './sandbox-settings';
import { TranscriptWriter } from './transcript';
import {
  totalTokens,
  type AgentStreamParser,
  type ExecRunEndReason,
  type ExecRunEvent,
  type ExecRunResult,
  type ExecRunSpec,
  type ResolveProviderBinary,
} from './types';

export interface ExecRunSupervisorOptions {
  /** Electron `app.getPath('userData')`, injected from main. */
  userDataDir: string;
  resolveBinary: ResolveProviderBinary;
  /** Worktree roots plus the review-checkout root. A run's cwd must sit inside one (SEC-31). */
  allowedRoots: () => readonly string[];
  maxConcurrentRuns: number;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** SIGTERM → SIGKILL delay. SEC-30 fixes it at 2 s. */
  killGraceMs?: number;
}

export type ExecRunRejection = 'stop-latched' | 'concurrency' | 'duplicate-run';

export class ExecRunRejectedError extends Error {
  constructor(readonly reason: ExecRunRejection) {
    super(`Run rejected: ${reason}`);
    this.name = 'ExecRunRejectedError';
  }
}

interface ActiveRun {
  child: ChildProcess;
  endReason?: ExecRunEndReason;
  terminating?: Promise<void>;
  done: Promise<ExecRunResult>;
}

const STDERR_TAIL = 8 * 1024;
/** Upper bound for killAll even if a process ignores SIGKILL (uninterruptible sleep). */
const KILL_ALL_SLACK_MS = 2500;

export class ExecRunSupervisor {
  private readonly active = new Map<string, ActiveRun>();
  private readonly preparing = new Set<string>();
  private readonly listeners = new Set<(event: ExecRunEvent) => void>();
  private latched = false;
  private readonly graceMs: number;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: ExecRunSupervisorOptions) {
    this.graceMs = options.killGraceMs ?? 2000;
    this.platform = options.platform ?? process.platform;
  }

  onEvent(listener: (event: ExecRunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get stopLatched(): boolean {
    return this.latched;
  }

  get activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Starts a run and resolves with its result once the process has exited. Rejects (before
   * spawning anything) while STOP is latched, at the concurrency cap, or on a reused runId.
   */
  async run(spec: ExecRunSpec, opts: { signal?: AbortSignal } = {}): Promise<ExecRunResult> {
    if (this.latched) throw new ExecRunRejectedError('stop-latched');
    if (this.active.has(spec.runId) || this.preparing.has(spec.runId)) {
      throw new ExecRunRejectedError('duplicate-run');
    }
    if (this.active.size + this.preparing.size >= this.options.maxConcurrentRuns) {
      throw new ExecRunRejectedError('concurrency');
    }
    this.preparing.add(spec.runId);
    let run: ActiveRun;
    try {
      run = await this.launch(spec);
    } finally {
      this.preparing.delete(spec.runId);
    }
    if (opts.signal) {
      const onAbort = () => void this.terminate(spec.runId, 'cancelled');
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
      void run.done.finally(() => opts.signal?.removeEventListener('abort', onAbort));
    }
    return run.done;
  }

  async cancel(runId: string): Promise<void> {
    await this.terminate(runId, 'cancelled');
  }

  /** SEC-30 global STOP. Latches until `clearStop()`; resolves when every run has exited. */
  async killAll(): Promise<void> {
    this.latched = true;
    this.emit({ type: 'stop-latched', activeRuns: this.active.size });
    const runs = [...this.active.entries()].map(([id, run]) => {
      void this.terminate(id, 'killed');
      return run.done.catch(() => undefined);
    });
    const deadline = new Promise((r) => setTimeout(r, this.graceMs + KILL_ALL_SLACK_MS));
    await Promise.race([Promise.all(runs), deadline]);
  }

  clearStop(): void {
    this.latched = false;
    this.emit({ type: 'stop-cleared' });
  }

  private terminate(runId: string, reason: ExecRunEndReason): Promise<void> {
    const run = this.active.get(runId);
    if (!run) return Promise.resolve();
    if (run.terminating) return run.terminating;
    run.endReason = reason;
    if (reason === 'wall-clock' || reason === 'tokens') {
      this.emit({ type: 'budget-exceeded', runId, budget: reason });
    }
    run.terminating = terminateGroup(run.child, this.graceMs, this.platform);
    return run.terminating;
  }

  private emit(event: ExecRunEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken UI listener must never take a run down with it.
      }
    }
  }

  private async launch(spec: ExecRunSpec): Promise<ActiveRun> {
    const { userDataDir } = this.options;
    const paths = runPaths(userDataDir, spec.runId);
    const cwd = await resolveRunCwd(spec.cwd, this.options.allowedRoots());
    const binary = await this.options.resolveBinary(spec.provider);
    await ensurePrivateDir(paths.root);
    await ensurePrivateDir(paths.configDir);

    const env = buildUnattendedEnv(this.options.parentEnv ?? process.env, {
      provider: spec.provider,
      auth: spec.auth,
      platform: this.platform === 'win32' ? 'windows' : 'posix',
    });
    const secrets = [
      ...(spec.auth?.ANTHROPIC_API_KEY ? [spec.auth.ANTHROPIC_API_KEY] : []),
      ...Object.values(spec.mcpServers ?? {}).flatMap((s) => Object.values(s.env ?? {})),
    ];

    let argv: string[];
    let parser: AgentStreamParser;
    let sandbox: unknown;
    if (spec.provider === 'claude') {
      const settings = buildClaudeSandboxSettings({
        preset: spec.preset,
        worktree: cwd,
        ninebrainsDataDir: ninebrainsDir(userDataDir),
        siblingWorktrees: spec.siblingWorktrees,
        claudeConfigDir: spec.auth?.CLAUDE_CONFIG_DIR,
        egressAllowedDomains: spec.egressAllowedDomains,
      });
      const settingsPath = join(paths.configDir, 'settings.json');
      const mcpConfigPath = join(paths.configDir, 'mcp.json');
      await writePrivateFile(settingsPath, JSON.stringify(settings, null, 2));
      await writePrivateFile(mcpConfigPath, buildClaudeMcpConfig(spec));
      argv = buildClaudePrintArgv(spec, { settingsPath, mcpConfigPath, sessionId: randomUUID() });
      parser = new ClaudeStreamParser();
      sandbox = settings;
    } else {
      argv = buildCodexExecArgv(spec, cwd);
      parser = new CodexEventParser();
      sandbox = { codexSandbox: spec.preset === 'reviewer' ? 'read-only' : 'workspace-write' };
    }

    const transcript = await TranscriptWriter.create(paths.transcript, createRedactor(secrets));
    transcript.record('header', {
      runId: spec.runId,
      provider: spec.provider,
      preset: spec.preset,
      binary,
      argv,
      cwd,
      env: describeEnvForTranscript(env),
      sandbox,
      budgets: spec.budgets,
    });

    // STOP may have been pressed while we were preparing.
    if (this.latched) {
      await transcript.close();
      await rm(paths.configDir, { recursive: true, force: true });
      throw new ExecRunRejectedError('stop-latched');
    }

    const startedAt = Date.now();
    const child = spawnInGroup(binary, argv, {
      cwd,
      env,
      stdin: spec.prompt,
      platform: this.platform,
    });
    const run: ActiveRun = { child, done: undefined as unknown as Promise<ExecRunResult> };
    this.active.set(spec.runId, run);

    run.done = new Promise<ExecRunResult>((resolve) => {
      let spawnError: Error | undefined;
      let stderrTail = '';
      const wallTimer = setTimeout(
        () => void this.terminate(spec.runId, 'wall-clock'),
        spec.budgets.wallClockMs
      );

      child.once('spawn', () => {
        this.emit({
          type: 'started',
          runId: spec.runId,
          provider: spec.provider,
          preset: spec.preset,
          pid: child.pid ?? -1,
        });
      });
      child.once('error', (err) => {
        spawnError = err;
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
        transcript.record('stderr', { text: chunk });
      });
      if (child.stdout) {
        createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
          transcript.raw(line);
          for (const event of parser.push(line)) {
            this.emit({ type: 'agent', runId: spec.runId, event });
            const max = spec.budgets.maxTokens;
            if (event.kind === 'usage' && max !== undefined && totalTokens(event.usage) > max) {
              void this.terminate(spec.runId, 'tokens');
            }
          }
        });
      }

      child.once('close', (code, signal) => {
        clearTimeout(wallTimer);
        // Reap anything the agent left running in its group (dev servers, watchers).
        signalGroup(child, 'SIGKILL', this.platform);
        const outcome = parser.finish();
        const reason: ExecRunEndReason =
          run.endReason ??
          (spawnError
            ? 'spawn-failed'
            : !outcome.sawResult
              ? 'no-result'
              : outcome.isError
                ? 'agent-error'
                : code !== 0
                  ? 'exit-nonzero'
                  : 'completed');
        const errors = [...outcome.errors];
        if (spawnError) errors.push(spawnError.message);
        if (reason !== 'completed' && stderrTail.trim())
          errors.push(stderrTail.trim().slice(-2000));
        const result: ExecRunResult = {
          runId: spec.runId,
          ok: reason === 'completed',
          reason,
          exitCode: code,
          signal,
          isError: reason !== 'completed',
          text: outcome.text,
          errors,
          usage: outcome.usage,
          totalTokens: totalTokens(outcome.usage),
          costUsd: outcome.costUsd,
          transcriptPath: paths.transcript,
          durationMs: Date.now() - startedAt,
        };
        transcript.record('outcome', { ...result, permissionDenials: outcome.permissionDenials });
        this.active.delete(spec.runId);
        void Promise.all([
          transcript.close(),
          rm(paths.configDir, { recursive: true, force: true }),
        ]).finally(() => {
          this.emit({ type: 'finished', runId: spec.runId, result });
          resolve(result);
        });
      });
    });
    return run;
  }
}

/** SEC-10 style: created 0600 at open time, never an existing file. */
async function writePrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Run supervisor for unattended agent runs, owned by main. Budgets are enforced here, not by
 * the agent (SEC-29): wall clock, tokens from stream usage, and a global cap on concurrent runs.
 * `killAll()` is the global STOP (SEC-30): it latches, SIGTERMs every run's process group and
 * SIGKILLs it at 2 s, so everything is gone well inside 5 s.
 *
 * Budget counters persist in each run's transcript (`ninebrains.budget` records), and `recover()`
 * closes runs a dead app instance left open as `killed` (SEC-29 restart half, `run-recovery.ts`).
 * Every counter change is also emitted as an event for the Brain DB.
 *
 * Codex has no max-turns flag: `maxTurns` does not apply to it. The wall clock bounds a Codex run,
 * and its token budget is checked on each `turn.completed` usage event, which Codex only sends at
 * the end of a turn, so for a single `codex exec` turn the wall clock is the real cap.
 */
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  assertLaunchPolicy,
  GATEWAY_ENV,
  LaunchPolicyError,
  routeLaunch,
} from '@core/features/routing/api/node/launch-env';
import { managedGatewaySettings } from '@core/features/routing/api/node/managed-settings';
import type { ArgvGuardOptions } from './argv-guard';
import { buildClaudeMcpConfig, buildClaudePrintArgv, ClaudeStreamParser } from './claude-print';
import { buildCodexExecLaunch, CodexEventParser } from './codex-exec';
import { resolveLaneGitPaths } from './lane-git-paths';
import {
  processGroups,
  signalGroup,
  spawnInGroup,
  terminateGroup,
  type ProcessGroupRegistry,
} from './process-group';
import { createRedactor, describeEnvForTranscript } from './redact';
import { buildUnattendedEnv } from './run-env';
import { ensurePrivateDir, ninebrainsDir, resolveRunCwd, runPaths } from './run-paths';
import { recoverInterruptedRuns } from './run-recovery';
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
  /**
   * T43: which of `allowedRoots` a run's cwd may equal exactly, not just sit inside — a lane's own
   * worktree, never the shared review-checkout root (see `resolveRunCwd`). Default: none, so an
   * exact match at any root is refused.
   */
  exactRootsAllowed?: () => readonly string[];
  maxConcurrentRuns: number;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** SIGTERM → SIGKILL delay. SEC-30 fixes it at 2 s. */
  killGraceMs?: number;
  /**
   * SEC-30: process groups started outside this supervisor (tests gate, review-checkout git).
   * `killAll()` latches and kills them too. Default: the app-wide registry.
   */
  groups?: ProcessGroupRegistry;
  /** Claude Code's managed-settings files to check (SEC-41). Default: the platform's. */
  managedSettingsPaths?: readonly string[];
}

/** SEC-41: why an init event contradicts the route, or null. `[1m]` suffixes are ignored. */
export function credentialMismatch(
  expect: { apiKeySource: string; model?: string },
  init: { apiKeySource?: string; model?: string }
): string | null {
  if (init.apiKeySource !== expect.apiKeySource) {
    return `expected credential ${expect.apiKeySource}, the CLI reported ${init.apiKeySource ?? 'nothing'}`;
  }
  const bare = (model: string) => model.replace(/\[1m\]$/, '');
  if (expect.model && (!init.model || bare(init.model) !== bare(expect.model))) {
    return `expected model ${expect.model}, the CLI reported ${init.model ?? 'nothing'}`;
  }
  return null;
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
    const others = this.groups.killAll(this.graceMs);
    const deadline = new Promise((r) => setTimeout(r, this.graceMs + KILL_ALL_SLACK_MS));
    await Promise.race([Promise.all([...runs, others]), deadline]);
  }

  clearStop(): void {
    this.latched = false;
    this.groups.clearStop();
    this.emit({ type: 'stop-cleared' });
  }

  /**
   * SEC-29: call once at app start, before any run. Runs a previous app instance left mid-flight
   * are closed as `killed` with their last persisted counters, and reported as `finished` events
   * so the Brain DB listener records them.
   */
  async recover(): Promise<ExecRunResult[]> {
    const results = (await recoverInterruptedRuns(this.options.userDataDir)).map(
      (run): ExecRunResult => ({
        runId: run.runId,
        ok: false,
        reason: 'killed',
        exitCode: null,
        signal: null,
        isError: true,
        errors: ['the app stopped while this run was active'],
        usage: run.usage,
        totalTokens: run.totalTokens,
        transcriptPath: run.transcriptPath,
        durationMs: run.elapsedMs,
      })
    );
    for (const result of results) this.emit({ type: 'finished', runId: result.runId, result });
    return results;
  }

  private managedGateway() {
    return managedGatewaySettings(this.options.managedSettingsPaths);
  }

  private get groups(): ProcessGroupRegistry {
    return this.options.groups ?? processGroups;
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
    const cwd = await resolveRunCwd(
      spec.cwd,
      this.options.allowedRoots(),
      this.options.exactRootsAllowed?.()
    );
    const binary = await this.options.resolveBinary(spec.provider);
    await ensurePrivateDir(paths.root);
    await ensurePrivateDir(paths.configDir);

    // The model route (SEC-39, SEC-40). An account API key is the one legacy non-subscription
    // mode: it keeps its key, so only the gateway neutralizers are dropped from its route.
    const accountKey = Boolean(spec.auth?.ANTHROPIC_API_KEY);
    const route = routeLaunch(spec.provider, spec.routing);
    if (accountKey && route.mode !== 'subscription') {
      throw new Error('A run cannot use both an account API key and a model profile.');
    }
    const routeEnv = accountKey
      ? Object.fromEntries(
          Object.entries(route.env).filter(([k]) => !(GATEWAY_ENV as readonly string[]).includes(k))
        )
      : route.env;
    const env = buildUnattendedEnv(this.options.parentEnv ?? process.env, {
      provider: spec.provider,
      auth: spec.auth,
      platform: this.platform === 'win32' ? 'windows' : 'posix',
      routing: routeEnv,
    });
    const secrets = [
      ...(spec.auth?.ANTHROPIC_API_KEY ? [spec.auth.ANTHROPIC_API_KEY] : []),
      ...route.secrets,
      ...Object.values(spec.mcpServers ?? {}).flatMap((s) =>
        Object.values((s.type === 'http' ? s.headers : s.env) ?? {})
      ),
    ];

    let argv: string[];
    let guard: ArgvGuardOptions;
    let parser: AgentStreamParser;
    let sandbox: unknown;
    let settingsEnvForPolicy: Record<string, string> | undefined;
    if (spec.provider === 'claude') {
      // SEC-41: managed settings outrank our `--settings`; a gateway there is refused.
      const managed = this.managedGateway();
      if (managed.length > 0) {
        throw new LaunchPolicyError(
          `managed Claude Code settings set ${managed.flatMap((m) => m.names).join(', ')} (${managed[0]!.path})`
        );
      }
      const settings = buildClaudeSandboxSettings({
        preset: spec.preset,
        worktree: cwd,
        ninebrainsDataDir: ninebrainsDir(userDataDir),
        userDataDir,
        siblingWorktrees: spec.siblingWorktrees,
        claudeConfigDir: spec.auth?.CLAUDE_CONFIG_DIR,
        // SEC-45: a profile run's egress is its plan allowlist plus the profile's API host.
        egressAllowedDomains:
          route.egressHosts.length > 0
            ? [...(spec.egressAllowedDomains ?? []), ...route.egressHosts]
            : spec.egressAllowedDomains,
        git: resolveLaneGitPaths(cwd),
      });
      const settingsPath = join(paths.configDir, 'settings.json');
      const mcpConfigPath = join(paths.configDir, 'mcp.json');
      // The route's `env` block outranks the user's own settings files (spike §13 Q2).
      const settingsEnv = accountKey ? {} : route.settingsEnv;
      settingsEnvForPolicy = settingsEnv;
      await writePrivateFile(
        settingsPath,
        JSON.stringify(
          Object.keys(settingsEnv).length > 0 ? { ...settings, env: settingsEnv } : settings,
          null,
          2
        )
      );
      await writePrivateFile(mcpConfigPath, buildClaudeMcpConfig(spec));
      const argvSpec = route.model && !spec.model ? { ...spec, model: route.model } : spec;
      argv = buildClaudePrintArgv(argvSpec, {
        settingsPath,
        mcpConfigPath,
        sessionId: randomUUID(),
      });
      guard = { provider: 'claude', trusted: [settingsPath, mcpConfigPath] };
      parser = new ClaudeStreamParser();
      sandbox = settings;
    } else {
      const launch = buildCodexExecLaunch(spec, cwd, route.codexConfig);
      argv = launch.argv;
      guard = { provider: 'codex', trusted: launch.trusted };
      parser = new CodexEventParser();
      sandbox = { codexSandbox: spec.preset === 'reviewer' ? 'read-only' : 'workspace-write' };
    }

    // SEC-39 on the final child env and argv, before anything is spawned.
    try {
      assertLaunchPolicy({
        provider: spec.provider,
        mode: accountKey ? 'account-api-key' : route.mode,
        env,
        ...(settingsEnvForPolicy && !accountKey ? { settingsEnv: settingsEnvForPolicy } : {}),
        argv,
        envKind: 'complete',
      });
    } catch (error) {
      await rm(paths.configDir, { recursive: true, force: true });
      throw error;
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

    const expect =
      spec.provider === 'claude'
        ? accountKey
          ? { apiKeySource: 'ANTHROPIC_API_KEY' }
          : route.expect
        : undefined;
    const startedAt = Date.now();
    const child = spawnInGroup(binary, argv, {
      cwd,
      env,
      stdin: spec.prompt,
      platform: this.platform,
      argvGuard: guard,
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
            if (event.kind === 'init' && expect) {
              // SEC-41: the credential and model the CLI actually resolved, before any work.
              const mismatch = credentialMismatch(expect, event);
              if (mismatch) {
                transcript.record('security', { kind: 'credential-mismatch', detail: mismatch });
                this.emit({
                  type: 'security',
                  runId: spec.runId,
                  kind: 'credential-mismatch',
                  detail: mismatch,
                });
                void this.terminate(spec.runId, 'credential-mismatch');
              }
            }
            if (event.kind !== 'usage') continue;
            // SEC-29: persisted, so a restart can close this run with its real counters.
            const used = totalTokens(event.usage);
            transcript.record('budget', {
              usage: event.usage,
              totalTokens: used,
              elapsedMs: Date.now() - startedAt,
            });
            const max = spec.budgets.maxTokens;
            if (max !== undefined && used > max) void this.terminate(spec.runId, 'tokens');
          }
        });
      }

      child.once('close', (code, signal) => {
        clearTimeout(wallTimer);
        // Reap anything the agent left running in its group (dev servers, watchers). SEC-30:
        // signalGroup already tolerates ESRCH/EPERM (the group, or its recycled pid, is gone
        // from our side), but this catch is the backstop — a reap failure of any kind must
        // never stop `resolve(result)` below from running, or the run would hang forever.
        let reapError: string | undefined;
        try {
          signalGroup(child, 'SIGKILL', this.platform);
        } catch (err) {
          reapError = err instanceof Error ? err.message : String(err);
          transcript.record('security', { kind: 'reap-failed', detail: reapError });
        }
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
        if (reapError) errors.push(`failed to reap leftover processes: ${reapError}`);
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

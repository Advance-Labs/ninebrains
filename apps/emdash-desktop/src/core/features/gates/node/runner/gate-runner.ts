/**
 * The gate runner (plan 4.1, SEAMS §3.11).
 *
 * When a job enters `verifying`, run its gates, decide pass / retry / block
 * with gates-core `decideSelfHeal`, and record the verdict in the Brain. On a
 * retry the Brain posts the feedback to the lane's inbox and the job goes back
 * to `running`; at the third failure it is blocked and `jobBlocked` fires.
 *
 * Idempotent per (jobId, attempt), where attempt = `job.attempts + 1`:
 * - concurrent triggers for the same attempt share one run;
 * - an interrupted run (shutdown, STOP) records nothing, so it is not a failed
 *   attempt; the next sweep runs it again;
 * - the verdict is written to `verdict.json` before it is recorded, so a crash
 *   in between replays that verdict instead of running the gates again;
 * - the Brain's `recordGateResult` takes the attempt as a compare-and-set, so a
 *   replayed or duplicate verdict can never count an attempt twice.
 */
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import {
  decideSelfHeal,
  runGates,
  type EvidenceStore,
  type Gate,
  type GateCapabilities,
  type GateJob,
  type GateRunReport,
  type RunStatus,
  type SelfHealDecision,
} from '@emdash/gates-core';
import {
  IllegalTransitionError,
  LIMITS,
  MAX_ATTEMPTS,
  type Brain,
  type Identity,
  type Job,
} from '@ninebrains/brain-core';
import { createRedactor, type Redactor } from '@core/features/exec-runs/api/node/redact';
import type { AttemptVerdict } from '../../api/verification';
import {
  MANIFEST_FILE,
  openAttemptEvidence,
  readVerdict,
  writeVerdict,
} from '../evidence/evidence';
import { gateJobKindOf, type RigorResolver } from '../rigor/rigor';
import { createReadWorktreeFile } from '../worktree/read-worktree-file';
import {
  defaultBuiltInGates,
  CONFIGURATION_ERROR_METRIC,
  effectiveGateIds,
  resolveGates,
  type BuiltInGates,
} from './gate-registry';
import type {
  GateLaneResolver,
  GateLaneTarget,
  GateRunnerCapabilities,
  ScreenshotHost,
} from './ports';

export const GATE_RUNNER_IDENTITY: Identity = { role: 'brain', brainId: 'gate-runner' };

export type GateRunnerBrain = Pick<
  Brain,
  'events' | 'getJob' | 'listJobs' | 'recordGateResult' | 'blockJob'
>;

export interface GateRunnerDeps {
  brain: GateRunnerBrain;
  lanes: GateLaneResolver;
  rigor: Pick<RigorResolver, 'resolveGateFloor' | 'projectPrefs'>;
  capabilities: GateRunnerCapabilities;
  screenshots?: ScreenshotHost;
  /** Gates from packs (`packs.createGates()`). */
  extraGates?: () => Gate[];
  /** Test seam. Defaults to the gates-core built-ins. */
  builtInGates?: BuiltInGates;
  /** `<userData>/ninebrains/evidence`. */
  evidenceRoot: string;
  /** SEC-35 redactor for evidence text. Defaults to the pattern redactor. */
  redact?: Redactor;
  identity?: Identity;
  gateTimeoutMs?: number;
  concurrency?: number;
  now?: () => number;
  onError?: (context: string, error: unknown) => void;
}

export interface GateRunOutcome {
  jobId: string;
  attempt: number;
  status: RunStatus;
  decision: AttemptVerdict['decision'];
  /** True when a stored verdict was replayed instead of running the gates. */
  replayed: boolean;
  /** False when nothing was recorded: interrupted, or the Brain had already moved on. */
  applied: boolean;
}

const UNAVAILABLE = (what: string) => () => Promise.reject(new Error(`${what} is unavailable`));

function setupFailure(error: unknown): Gate {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: 'setup',
    title: 'Verification setup',
    appliesTo: () => true,
    run: () => Promise.reject(new Error(message)),
  };
}

/** SEC-22: worker artifacts are left out on purpose; gates produce their own evidence. */
function toGateJob(job: Job, attempt: number): GateJob {
  const baseRef = job.gateSpec?.baseRef;
  return {
    id: job.id,
    title: job.title,
    body: job.body,
    kind: gateJobKindOf(job.gateSpec),
    attempt,
    ...(typeof baseRef === 'string' ? { baseRef } : {}),
  };
}

async function assertOutsideWorktree(root: string, worktreePath: string): Promise<void> {
  const [realRoot, realTree] = await Promise.all([
    realpath(root).catch(() => root),
    realpath(worktreePath),
  ]);
  const rel = relative(realTree, realRoot);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error('the evidence root is inside the lane worktree (SEC-24)');
  }
}

export class GateRunnerService {
  private readonly inflight = new Map<string, Promise<GateRunOutcome>>();
  private readonly controllers = new Set<AbortController>();
  private readonly identity: Identity;
  private readonly redact: Redactor;
  private readonly builtIns: BuiltInGates;
  private unsubscribe: (() => void) | undefined;
  private stopped = false;

  constructor(private readonly deps: GateRunnerDeps) {
    this.identity = deps.identity ?? GATE_RUNNER_IDENTITY;
    this.redact = deps.redact ?? createRedactor();
    this.builtIns = deps.builtInGates ?? defaultBuiltInGates;
  }

  /** Subscribes to Brain events and picks up jobs left in `verifying` by a crash. */
  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    this.unsubscribe = this.deps.brain.events.on('jobChanged', ({ job }) => {
      if (job.state === 'verifying') this.trigger(job.id);
    });
    void this.sweep().catch((error: unknown) => this.report('gates: sweep failed', error));
  }

  /** Aborts running gates. Interrupted attempts are not counted; `start()` resumes them. */
  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const controller of this.controllers) controller.abort(new Error('gate runner stopped'));
  }

  /** Verifies every job currently in `verifying`. */
  async sweep(): Promise<Array<GateRunOutcome | undefined>> {
    const jobs = this.deps.brain.listJobs(this.identity, { states: ['verifying'] });
    return Promise.all(jobs.map((job) => this.verifyJob(job.id)));
  }

  /**
   * Runs (or joins the run of) the job's current attempt. Resolves undefined
   * when the job is not verifying or the runner is stopped.
   */
  verifyJob(jobId: string): Promise<GateRunOutcome | undefined> {
    if (this.stopped) return Promise.resolve(undefined);
    let job: Job;
    try {
      job = this.deps.brain.getJob(this.identity, jobId);
    } catch (error) {
      this.report(`gates: cannot load job ${jobId}`, error);
      return Promise.resolve(undefined);
    }
    if (job.state !== 'verifying') return Promise.resolve(undefined);
    const attempt = job.attempts + 1;
    const key = `${job.id}#${attempt}`;
    const running = this.inflight.get(key);
    if (running) return running;

    const controller = new AbortController();
    this.controllers.add(controller);
    const run = this.execute(job, attempt, controller.signal).finally(() => {
      this.inflight.delete(key);
      this.controllers.delete(controller);
    });
    this.inflight.set(key, run);
    return run;
  }

  private trigger(jobId: string): void {
    void this.verifyJob(jobId).catch((error: unknown) =>
      this.report(`gates: verification of ${jobId} failed`, error)
    );
  }

  private async execute(job: Job, attempt: number, signal: AbortSignal): Promise<GateRunOutcome> {
    const stored = await readVerdict(this.deps.evidenceRoot, job.id, attempt);
    // Replay only a verdict from this same stay in `verifying`; a requeued job starts over.
    if (stored && stored.jobUpdatedAt === job.updatedAt) return this.apply(job, stored, true);

    const { verdict, evidence } = await this.runAttempt(job, attempt, signal);
    if (signal.aborted) return { ...this.outcomeOf(verdict, false), applied: false };
    if (evidence) await writeVerdict(evidence.dir, verdict);
    return this.apply(job, verdict, false, evidence?.dir);
  }

  private async runAttempt(
    job: Job,
    attempt: number,
    signal: AbortSignal
  ): Promise<{ verdict: AttemptVerdict; evidence: EvidenceStore | undefined }> {
    const gateJob = toGateJob(job, attempt);
    const floor = this.deps.rigor.resolveGateFloor(
      job.projectId,
      job.hints.kind ?? 'work',
      job.gateSpec
    );
    const gateIds = effectiveGateIds(floor, job.gateSpec);
    const options = { timeoutMs: this.deps.gateTimeoutMs, concurrency: this.deps.concurrency };
    let evidence: EvidenceStore | undefined;
    let report: GateRunReport;
    let setupFailed = false;
    try {
      evidence = await openAttemptEvidence({
        root: this.deps.evidenceRoot,
        jobId: job.id,
        attempt,
        redact: this.redact,
      });
      const { testCommand } = this.deps.rigor.projectPrefs(job.projectId);
      const gates = resolveGates({
        ids: gateIds,
        builtIns: this.builtIns({ testCommand }),
        extra: this.deps.extraGates?.() ?? [],
        onError: (message) => this.report(message, undefined),
      });
      const lane = gates.length > 0 ? await this.laneFor(job) : undefined;
      report = await runGates(
        gateJob,
        gates,
        {
          worktreePath: lane?.worktreePath ?? '',
          previewUrl: lane?.previewUrl,
          evidence,
          signal,
          capabilities: lane ? this.capabilitiesFor(lane) : this.unboundCapabilities(),
        },
        options
      );
    } catch (error) {
      setupFailed = true;
      report = await runGates(
        gateJob,
        [setupFailure(error)],
        {
          worktreePath: '',
          evidence: evidence ?? { dir: '', list: () => [], put: UNAVAILABLE('evidence storage') },
          signal,
          capabilities: this.unboundCapabilities(),
        },
        options
      );
    }

    // Setup problems (no test command, sandbox refused, lane gone) aren't the worker's to fix.
    const nonRetryable =
      report.status === 'failed' &&
      (setupFailed ||
        report.results.some((r) => !r.pass && r.metrics?.[CONFIGURATION_ERROR_METRIC] === 1));
    const decision: SelfHealDecision = nonRetryable
      ? {
          action: 'block',
          reason: `Verification can't run until the user fixes the setup, so no attempt was used.\n\n${report.feedback}`,
        }
      : decideSelfHeal(report, attempt, MAX_ATTEMPTS);
    const feedback =
      decision.action === 'retry'
        ? decision.feedback
        : decision.action === 'block'
          ? decision.reason
          : report.feedback;
    const verdict: AttemptVerdict = {
      version: 1,
      jobId: job.id,
      attempt,
      jobUpdatedAt: job.updatedAt,
      status: report.status,
      decision: decision.action,
      ...(nonRetryable ? { nonRetryable: true } : {}),
      feedback: this.redact(feedback),
      gateIds,
      gates: report.results.map((r) => ({
        gateId: r.gateId,
        title: r.title,
        status: r.status,
        feedback: this.redact(r.feedback),
        durationMs: r.durationMs,
        evidence: r.evidence.map((e) => ({ kind: e.kind, label: e.label, file: basename(e.path) })),
      })),
      skipped: report.skipped,
      at: (this.deps.now ?? Date.now)(),
    };
    return { verdict, evidence };
  }

  private async laneFor(job: Job): Promise<GateLaneTarget> {
    const lane = job.laneId ? await this.deps.lanes.resolve(job.laneId) : undefined;
    if (!lane) {
      throw new Error(
        `lane ${job.laneId ?? '(none)'} is not available, so its work can't be checked`
      );
    }
    await assertOutsideWorktree(this.deps.evidenceRoot, lane.worktreePath);
    return lane;
  }

  private capabilitiesFor(lane: GateLaneTarget): GateCapabilities {
    const screenshots = this.deps.screenshots;
    return {
      ...this.deps.capabilities,
      captureScreenshot: screenshots
        ? (viewport, opts) =>
            screenshots.capture(
              { laneId: lane.laneId, browserId: lane.browserId, partition: lane.partition },
              viewport,
              opts
            )
        : UNAVAILABLE('the lane browser'),
      readWorktreeFile: createReadWorktreeFile(lane.worktreePath),
    };
  }

  private unboundCapabilities(): GateCapabilities {
    return {
      ...this.deps.capabilities,
      captureScreenshot: UNAVAILABLE('the lane browser'),
      readWorktreeFile: UNAVAILABLE('the lane worktree'),
    };
  }

  private outcomeOf(verdict: AttemptVerdict, replayed: boolean): Omit<GateRunOutcome, 'applied'> {
    return {
      jobId: verdict.jobId,
      attempt: verdict.attempt,
      status: verdict.status,
      decision: verdict.decision,
      replayed,
    };
  }

  private apply(
    job: Job,
    verdict: AttemptVerdict,
    replayed: boolean,
    dir?: string
  ): GateRunOutcome {
    const evidenceDir = dir ?? join(this.deps.evidenceRoot, verdict.jobId, String(verdict.attempt));
    const evidencePath = verdict.gates.some((gate) => gate.evidence.length > 0)
      ? join(evidenceDir, MANIFEST_FILE)
      : undefined;
    const outcome = this.outcomeOf(verdict, replayed);
    try {
      if (verdict.nonRetryable) {
        // Block without counting an attempt; the attempt check still guards replays.
        const current = this.deps.brain.getJob(this.identity, job.id);
        if (current.state !== 'verifying' || current.attempts + 1 !== verdict.attempt) {
          return { ...outcome, applied: false };
        }
        this.deps.brain.blockJob(
          this.identity,
          job.id,
          verdict.feedback.slice(0, LIMITS.reasonChars)
        );
        return { ...outcome, applied: true };
      }
      this.deps.brain.recordGateResult(
        this.identity,
        job.id,
        verdict.decision === 'pass'
          ? { pass: true, status: verdict.status, attempt: verdict.attempt, evidencePath }
          : {
              pass: false,
              status: 'failed',
              attempt: verdict.attempt,
              feedback: verdict.feedback,
              evidencePath,
            }
      );
      return { ...outcome, applied: true };
    } catch (error) {
      // Someone already recorded this attempt, or the job moved on: nothing to count twice.
      if (error instanceof IllegalTransitionError) return { ...outcome, applied: false };
      throw error;
    }
  }

  private report(context: string, error: unknown): void {
    this.deps.onError?.(context, error);
  }
}

/**
 * The gate runner.
 *
 * Every applicable gate must pass. A gate that throws, times out, returns a
 * malformed result, or is cancelled counts as a failure: a gate that could not
 * reach a verdict has not verified anything. The combined feedback is written
 * for the worker agent that will read it on its next attempt, so it leads with
 * what to fix and stays short.
 */

import type { Evidence, Gate, GateContext, GateResult, GateJob } from './types';
import { errorMessage, truncate } from './util';

export type GateStatus = 'pass' | 'fail' | 'timeout' | 'error' | 'cancelled';

export interface GateOutcome extends GateResult {
  gateId: string;
  title: string;
  status: GateStatus;
  durationMs: number;
}

export interface GateRunReport {
  pass: boolean;
  results: GateOutcome[];
  /** Ids of gates whose appliesTo() returned false. */
  skipped: string[];
  evidence: Evidence[];
  feedback: string;
}

export interface RunGatesOptions {
  /** Per-gate budget. Default 10 minutes. */
  timeoutMs?: number;
  /** Gates run at once. Default 2. */
  concurrency?: number;
}

export type GateRunContext = Omit<GateContext, 'job'>;

export const DEFAULT_GATE_TIMEOUT_MS = 10 * 60 * 1000;
const FEEDBACK_PER_GATE = 1500;

function outcome(
  gate: Pick<Gate, 'id' | 'title'>,
  status: GateStatus,
  started: number,
  result: Partial<GateResult> & { feedback: string }
): GateOutcome {
  return {
    gateId: gate.id,
    title: gate.title,
    status,
    pass: status === 'pass',
    evidence: result.evidence ?? [],
    feedback: result.feedback,
    metrics: result.metrics,
    durationMs: Date.now() - started,
  };
}

function isGateResult(value: unknown): value is GateResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.pass === 'boolean' && typeof r.feedback === 'string' && Array.isArray(r.evidence);
}

async function runOne(gate: Gate, ctx: GateContext, timeoutMs: number): Promise<GateOutcome> {
  const started = Date.now();
  if (ctx.signal.aborted) {
    return outcome(gate, 'cancelled', started, { feedback: 'Verification was cancelled.' });
  }

  const controller = new AbortController();
  const forward = () => controller.abort(ctx.signal.reason);
  ctx.signal.addEventListener('abort', forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const running = Promise.resolve().then(() => gate.run({ ...ctx, signal: controller.signal }));
  // After a timeout or cancel the gate may still settle; never let that go unhandled.
  running.catch(() => undefined);

  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const cancelled = new Promise<'cancelled'>((resolve) => {
    ctx.signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
  });

  try {
    const raced = await Promise.race([running.then((result) => ({ result })), timedOut, cancelled]);
    if (raced === 'timeout') {
      controller.abort(new Error(`gate ${gate.id} timed out`));
      return outcome(gate, 'timeout', started, {
        feedback: `Gate did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped.`,
      });
    }
    if (raced === 'cancelled') {
      return outcome(gate, 'cancelled', started, { feedback: 'Verification was cancelled.' });
    }
    if (!isGateResult(raced.result)) {
      return outcome(gate, 'error', started, {
        feedback: 'Gate returned a malformed result (internal error, not your change).',
      });
    }
    const result = raced.result;
    return outcome(gate, result.pass ? 'pass' : 'fail', started, result);
  } catch (error) {
    return outcome(gate, 'error', started, {
      feedback: `Gate crashed before reaching a verdict: ${errorMessage(error)}`,
    });
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', forward);
  }
}

const STATUS_LABEL: Record<GateStatus, string> = {
  pass: 'passed',
  fail: 'failed',
  timeout: 'timed out',
  error: 'errored',
  cancelled: 'cancelled',
};

/** Feedback for the worker agent. Short, failures only, in gate order. */
export function composeFeedback(job: GateJob, results: GateOutcome[]): string {
  if (results.length === 0) return 'No verification gates applied to this job.';
  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) return `All ${results.length} verification gates passed.`;

  const sections = failed.map(
    (r) =>
      `## ${r.title} (${r.gateId}) ${STATUS_LABEL[r.status]}\n${truncate(r.feedback.trim(), FEEDBACK_PER_GATE)}`
  );
  return [
    `Verification failed on attempt ${job.attempt}: ${failed.length} of ${results.length} ` +
      'gates did not pass. Fix the issues below, then call complete_task again.',
    ...sections,
  ].join('\n\n');
}

export async function runGates(
  job: GateJob,
  gates: Gate[],
  ctx: GateRunContext,
  options: RunGatesOptions = {}
): Promise<GateRunReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const context: GateContext = { ...ctx, job };

  const skipped: string[] = [];
  const planned: Array<{ index: number; run: () => Promise<GateOutcome> }> = [];
  const results: GateOutcome[] = [];

  for (const gate of gates) {
    let applies: boolean;
    try {
      applies = gate.appliesTo(job);
    } catch (error) {
      const started = Date.now();
      const failed = outcome(gate, 'error', started, {
        feedback: `Gate could not decide whether it applies: ${errorMessage(error)}`,
      });
      planned.push({ index: planned.length, run: async () => failed });
      continue;
    }
    if (!applies) {
      skipped.push(gate.id);
      continue;
    }
    planned.push({ index: planned.length, run: () => runOne(gate, context, timeoutMs) });
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, planned.length) }, async () => {
    while (next < planned.length) {
      const item = planned[next];
      next += 1;
      results[item.index] = await item.run();
    }
  });
  await Promise.all(workers);

  return {
    pass: results.every((r) => r.pass),
    results,
    skipped,
    evidence: results.flatMap((r) => r.evidence),
    feedback: composeFeedback(job, results),
  };
}

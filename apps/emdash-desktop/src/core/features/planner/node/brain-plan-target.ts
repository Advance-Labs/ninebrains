import {
  BrainError,
  CycleError,
  type Brain,
  type GateSpec,
  type Identity,
} from '@ninebrains/brain-core';
import type { PlannerJobState } from '../api';
import type { PlanCompileRequest, PlanCompileResult, PlanJob, PlanTarget } from './ports';

const PLANNER_IDENTITY: Identity = { role: 'brain', brainId: 'planner' };

/**
 * The canvas is the user's own surface: compiling it runs as the app's planner identity, never an
 * agent token, so any gate kind the user set on a node is kept (SEC-08 restricts agents only).
 */
function gateSpecOf(job: PlanJob): GateSpec | null {
  const gates = job.gates ?? [];
  if (gates.length === 0 && !job.gateKind) return null;
  return { gates, ...(job.gateKind ? { kind: job.gateKind } : {}) };
}

/**
 * The PlanTarget over brain-core. Compile logic (idempotent upsert, archiving,
 * cycle rejection) lives in `Brain.compilePlan`; this only adapts shapes.
 */
export function createBrainPlanTarget(
  brain: Brain,
  identity: Identity = PLANNER_IDENTITY
): PlanTarget {
  const nodeIdsByJob = (planId: string): Map<string, string> =>
    new Map(
      brain
        .listJobs(identity, { planId, includeArchived: true })
        .flatMap((job) => (job.planNodeId ? [[job.id, job.planNodeId] as const] : []))
    );

  return {
    compile(request: PlanCompileRequest): PlanCompileResult {
      try {
        const result = brain.compilePlan(identity, {
          planId: request.planId,
          projectId: request.projectId,
          nodes: request.jobs.map((job) => ({
            id: job.id,
            title: job.title,
            body: job.body,
            gateSpec: gateSpecOf(job),
            // Routing hint (work | review), separate from the gate kind above.
            hints: job.kind ? { kind: job.kind } : undefined,
          })),
          edges: request.edges,
        });
        return {
          ok: true,
          created: result.created.length,
          updated: result.updated.length,
          unchanged: result.unchanged.length,
          archived: result.archived.length,
        };
      } catch (error) {
        if (error instanceof CycleError) {
          // A plan-local cycle is reported in node ids; a cycle through the
          // project's other edges is reported in job ids. Map what we can.
          const known = nodeIdsByJob(request.planId);
          return { ok: false, kind: 'cycle', path: error.path.map((id) => known.get(id) ?? id) };
        }
        if (error instanceof BrainError)
          return { ok: false, kind: 'invalid', message: error.message };
        throw error;
      }
    },

    jobStates(_projectId: string, planId: string): Record<string, PlannerJobState> {
      const states: Record<string, PlannerJobState> = {};
      for (const job of brain.listJobs(identity, { planId })) {
        if (job.planNodeId) states[job.planNodeId] = job.state;
      }
      return states;
    },

    subscribe(listener: () => void): () => void {
      return brain.events.on('jobChanged', () => listener());
    },
  };
}

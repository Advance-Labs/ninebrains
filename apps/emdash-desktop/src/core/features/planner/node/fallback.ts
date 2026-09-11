import { createMementoCanvasStore, createMemoryMementoRowPort } from './canvas-store';
import { createPlannerService, type PlannerService } from './planner-service';
import type { PlanTarget } from './ports';

export const BRAIN_NOT_CONNECTED_MESSAGE =
  'The Brain is not connected yet, so the plan cannot run. Canvas edits are kept for this session only.';

/**
 * Used until the integrator passes a real PlannerService into the controller
 * context: canvases live in memory and "Run plan" explains why it can't run.
 */
export function createUnwiredPlannerService(): PlannerService {
  const planTarget: PlanTarget = {
    compile: () => ({ ok: false, kind: 'invalid', message: BRAIN_NOT_CONNECTED_MESSAGE }),
    jobStates: () => ({}),
  };
  return createPlannerService({
    canvasStore: createMementoCanvasStore(createMemoryMementoRowPort()),
    planTarget,
  });
}

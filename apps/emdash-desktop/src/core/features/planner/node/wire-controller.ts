import { createController, type Controller } from '@emdash/wire/rpc';
import { plannerContract } from '../api';
import type { PlannerService } from './planner-service';

export function createPlannerWireController(service: PlannerService): Controller {
  return createController(plannerContract, {
    listCanvases: (input) => service.listCanvases(input.projectId),
    getCanvas: (input) => service.getCanvas(input),
    saveCanvas: (input) => service.saveCanvas(input.doc),
    compile: (input) => service.compile(input),
    draftFromBrief: (input) => service.draftFromBrief(input),
    nodeStates: service.nodeStates,
  });
}

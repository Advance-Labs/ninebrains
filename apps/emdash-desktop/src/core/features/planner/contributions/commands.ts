import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';

/**
 * Opens the planner canvas. With no `projectId` it opens the current project's canvas, or the
 * first project's when no project is in view. Other slices run it by id with `{ projectId }`.
 */
export const openPlannerCommand = defineCommand({
  id: 'planner.open',
  title: 'Open Planner',
  description: "Plan a project's jobs and dependencies on a canvas",
  category: 'Planner',
  icon: 'workflow',
  // Optional, so the command palette can run it without arguments.
  input: z.object({ projectId: z.string().min(1) }).optional(),
});

/** Available everywhere (window scope). */
export const PLANNER_WINDOW_COMMAND_DEFS = [openPlannerCommand] as const;

export const PLANNER_COMMAND_DEFS = [...PLANNER_WINDOW_COMMAND_DEFS] as const;

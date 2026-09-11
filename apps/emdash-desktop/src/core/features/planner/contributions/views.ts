import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/** The canvas a project opens when no `canvasId` is given. */
export const DEFAULT_CANVAS_ID = 'main';

const plannerViewParams = z.object({
  projectId: z.string().min(1),
  canvasId: z.string().min(1).optional(),
});

// Explicit generics: the planner has no telemetry event, and leaving the event
// type to default (`string`) would widen the catalog's event union for every view.
export const plannerViewDef = defineView<
  'planner',
  typeof plannerViewParams,
  typeof workbenchLayout,
  z.ZodNever,
  never
>({
  id: 'planner',
  params: plannerViewParams,
  layout: workbenchLayout,
});

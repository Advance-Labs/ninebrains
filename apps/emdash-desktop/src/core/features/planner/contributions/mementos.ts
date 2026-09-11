import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { defineSubject } from '@core/primitives/subjects/api';

/**
 * One planner canvas. The node-side canvas store keys its document rows by the
 * same kind and encoding, so viewport and document share one identity.
 */
export const plannerCanvasSubject = defineSubject({
  kind: 'planner-canvas',
  key: z.object({ projectId: z.string().min(1), canvasId: z.string().min(1) }),
  encode: ({ projectId, canvasId }) => `${projectId}/${canvasId}`,
});

const plannerViewportV1Schema = z.object({
  version: z.literal('1'),
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().min(0.05).max(8),
});

export const plannerViewportSchema = defineVersionedSchema()
  .initial('1', plannerViewportV1Schema)
  .build();
export type PlannerViewportState = typeof plannerViewportSchema.Type;

/** Pan and zoom only. The canvas document itself lives behind the node-side CanvasStore. */
export const plannerViewportMemento = defineMemento({
  id: 'planner.viewport',
  subject: plannerCanvasSubject,
  schema: plannerViewportSchema,
  default: { version: '1' as const, x: 0, y: 0, zoom: 1 },
  retention: { tier: 'persisted', maxAge: days(90), maxEntries: 500 },
});

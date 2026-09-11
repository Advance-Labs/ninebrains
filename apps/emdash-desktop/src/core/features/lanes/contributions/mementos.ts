import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';
import { laneTabConfigSchema } from '../api';

const lanesGridV1Schema = z.object({
  version: z.literal('1'),
  tabs: z.array(laneTabConfigSchema),
});

export const lanesGridSchema = defineVersionedSchema().initial('1', lanesGridV1Schema).build();
export type LanesGridState = typeof lanesGridSchema.Type;

/**
 * Lane configuration and grid membership: tabs → slots(0-3) → lane config.
 * Written only by LaneService in main; grid sizes live in the standard
 * panel-layouts memento through the Resizable layout storage.
 */
export const lanesGridMemento = defineMemento({
  id: 'lanes.grid',
  subject: appSubject,
  schema: lanesGridSchema,
  default: {
    version: '1' as const,
    tabs: [],
  },
});

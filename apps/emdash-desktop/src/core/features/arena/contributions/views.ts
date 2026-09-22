import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const arenaViewDef = defineView({
  id: 'arena',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'arena_viewed',
});

import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/** The grid of lanes. Without a `tabId` the view shows the first tab. */
export const lanesViewDef = defineView({
  id: 'lanes',
  params: z.object({
    tabId: z.string().optional(),
  }),
  layout: workbenchLayout,
  // No telemetry event; pinning the type keeps the catalog's event union narrow.
  telemetryEvent: undefined as never,
});

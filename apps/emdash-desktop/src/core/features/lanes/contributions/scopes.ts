import { z } from 'zod';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import { LANES_VIEW_COMMAND_DEFS } from './commands';

export const lanesViewScope = defineViewScope({
  id: 'view.lanes',
  params: z.object({}),
  commands: LANES_VIEW_COMMAND_DEFS,
  activation: 'logical',
});

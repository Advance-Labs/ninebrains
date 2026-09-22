import { arenaViewDef } from '@core/features/arena/contributions/views';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { lanesViewDef } from '@core/features/lanes/contributions/views';
import { plannerViewDef } from '@core/features/planner/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { defineViewCatalog } from '@core/primitives/views/api';

export const viewCatalog = defineViewCatalog([
  homeViewDef,
  arenaViewDef,
  automationsViewDef,
  projectViewDef,
  taskViewDef,
  settingsViewDef,
  lanesViewDef,
  plannerViewDef,
] as const);

export type ViewId = (typeof viewCatalog.defs)[number]['id'];

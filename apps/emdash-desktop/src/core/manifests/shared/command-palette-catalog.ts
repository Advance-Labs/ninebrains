import { BRAIN_COMMAND_PALETTE_ITEMS } from '@core/features/brain/contributions/palette';
import { DEV_PERF_COMMAND_PALETTE_ITEMS } from '@core/features/dev-perf/contributions/palette';
import { LANES_COMMAND_PALETTE_ITEMS } from '@core/features/lanes/contributions/palette';
import { PLANNER_COMMAND_PALETTE_ITEMS } from '@core/features/planner/contributions/palette';
import { TASK_COMMAND_PALETTE_ITEMS } from '@core/features/tasks/contributions/palette';
import { WORKBENCH_COMMAND_PALETTE_ITEMS } from '@core/features/workbench/contributions/palette';
import { defineCommandPaletteCatalog } from '@core/primitives/palette/api';
import { COMMAND_CATALOG } from './command-catalog';

export const COMMAND_PALETTE_CATALOG = defineCommandPaletteCatalog(COMMAND_CATALOG, [
  ...WORKBENCH_COMMAND_PALETTE_ITEMS,
  ...TASK_COMMAND_PALETTE_ITEMS,
  ...DEV_PERF_COMMAND_PALETTE_ITEMS,
  ...LANES_COMMAND_PALETTE_ITEMS,
  ...BRAIN_COMMAND_PALETTE_ITEMS,
  ...PLANNER_COMMAND_PALETTE_ITEMS,
] as const);

export type CommandPaletteCommandId =
  (typeof COMMAND_PALETTE_CATALOG.items)[number]['command']['id'];

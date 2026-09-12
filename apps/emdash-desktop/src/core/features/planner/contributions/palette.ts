import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { openPlannerCommand } from './commands';

export const PLANNER_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({ command: openPlannerCommand }),
] as const;

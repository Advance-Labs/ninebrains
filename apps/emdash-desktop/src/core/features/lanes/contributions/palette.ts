import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { openLanesCommand } from './commands';

export const LANES_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({ command: openLanesCommand }),
] as const;

import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { brainStopAllCommand } from './commands';

export const BRAIN_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({ command: brainStopAllCommand }),
] as const;

import { defineCommand } from '@core/primitives/commands/api';
import { keybinding } from '@core/primitives/keybindings/api';

/**
 * Global STOP (SEC-30): kills every unattended run, pauses dispatch and stops
 * Brain-dispatched attended lanes. Window scope, so it works from any view
 * and while a terminal has focus. The work itself runs in main.
 */
export const brainStopAllCommand = defineCommand({
  id: 'brain.stopAll',
  title: 'Stop All Agent Work',
  description: 'Kill Brain runs, pause dispatch and stop Brain-dispatched lanes',
  category: 'Brain',
  icon: 'octagon-x',
  keybinding: keybinding.fixed('Mod+Shift+Backspace', { allowWhenTerminalFocused: true }),
});

/** Available everywhere (window scope). */
export const BRAIN_WINDOW_COMMAND_DEFS = [brainStopAllCommand] as const;

export const BRAIN_COMMAND_DEFS = [...BRAIN_WINDOW_COMMAND_DEFS] as const;

import { defineCommand } from '@core/primitives/commands/api';
import { keybinding } from '@core/primitives/keybindings/api';

// Lanes are terminals, so their shortcuts must also fire while a terminal has focus.
const inTerminals = { allowWhenTerminalFocused: true } as const;

export const openLanesCommand = defineCommand({
  id: 'lanes.open',
  title: 'Open Lanes',
  description: 'Show the grid of agent lanes',
  category: 'Lanes',
  icon: 'columns-2',
});

export const focusLane1Command = defineCommand({
  id: 'lanes.focusLane1',
  title: 'Focus Lane 1',
  category: 'Lanes',
  keybinding: keybinding.fixed('Mod+1', inTerminals),
});

export const focusLane2Command = defineCommand({
  id: 'lanes.focusLane2',
  title: 'Focus Lane 2',
  category: 'Lanes',
  keybinding: keybinding.fixed('Mod+2', inTerminals),
});

export const focusLane3Command = defineCommand({
  id: 'lanes.focusLane3',
  title: 'Focus Lane 3',
  category: 'Lanes',
  keybinding: keybinding.fixed('Mod+3', inTerminals),
});

export const focusLane4Command = defineCommand({
  id: 'lanes.focusLane4',
  title: 'Focus Lane 4',
  category: 'Lanes',
  keybinding: keybinding.fixed('Mod+4', inTerminals),
});

export const toggleMaximizeLaneCommand = defineCommand({
  id: 'lanes.toggleMaximize',
  title: 'Maximize Focused Lane',
  description: 'Give the focused lane most of the grid; dim the others',
  category: 'Lanes',
  keybinding: keybinding.fixed('Mod+Shift+Enter', inTerminals),
});

export const FOCUS_LANE_COMMANDS = [
  focusLane1Command,
  focusLane2Command,
  focusLane3Command,
  focusLane4Command,
] as const;

/** Available everywhere (window scope). */
export const LANES_WINDOW_COMMAND_DEFS = [openLanesCommand] as const;

/** Available while the Lanes view is showing. */
export const LANES_VIEW_COMMAND_DEFS = [...FOCUS_LANE_COMMANDS, toggleMaximizeLaneCommand] as const;

export const LANES_COMMAND_DEFS = [
  ...LANES_WINDOW_COMMAND_DEFS,
  ...LANES_VIEW_COMMAND_DEFS,
] as const;

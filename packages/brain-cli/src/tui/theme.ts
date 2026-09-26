/**
 * TUI color theme and styling constants.
 */

export const COLORS = {
  primary: 'cyan',
  secondary: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  muted: 'dim',
  text: 'white',
  bg: 'black',
} as const;

export const SYMBOLS = {
  bullet: '●',
  circle: '○',
  arrow: '→',
  check: '✓',
  cross: '✗',
  pending: '◐',
  blocked: '■',
  ready: '●',
  running: '▶',
  done: '✓',
  failed: '✗',
  idle: '◌',
  waiting: '◐',
  verifying: '◑',
  asleep: '◒',
} as const;

export const STATE_COLORS: Record<string, string> = {
  proposed: 'gray',
  ready: 'green',
  claimed: 'yellow',
  running: 'blue',
  verifying: 'magenta',
  done: 'green',
  blocked: 'red',
  failed: 'red',
};

export const LANE_STATUS_COLORS: Record<string, string> = {
  idle: 'gray',
  running: 'blue',
  waiting: 'yellow',
  verifying: 'magenta',
  blocked: 'red',
  asleep: 'dim',
};

export function stateColor(state: string): string {
  return STATE_COLORS[state] ?? 'white';
}

export function laneStatusColor(status: string): string {
  return LANE_STATUS_COLORS[status] ?? 'white';
}

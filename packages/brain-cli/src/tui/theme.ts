/**
 * TUI colors for job states and lane statuses.
 */

const STATE_COLORS: Record<string, string> = {
  proposed: 'gray',
  ready: 'green',
  claimed: 'yellow',
  running: 'blue',
  verifying: 'magenta',
  done: 'green',
  blocked: 'red',
  failed: 'red',
};

const LANE_STATUS_COLORS: Record<string, string> = {
  idle: 'gray',
  running: 'blue',
  waiting: 'yellow',
  verifying: 'magenta',
  blocked: 'red',
  asleep: 'gray',
};

export function stateColor(state: string): string {
  return STATE_COLORS[state] ?? 'white';
}

export function laneStatusColor(status: string): string {
  return LANE_STATUS_COLORS[status] ?? 'white';
}

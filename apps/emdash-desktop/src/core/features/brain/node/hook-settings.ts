import {
  EMDASH_HOOK_CONFIG_VERSION,
  makeStdinHookCommand,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

type HookGroup = { matcher?: string; hooks: Array<{ type: 'command'; command: string }> };

/** Upstream's hook version marker is kept, so its cleanup still recognises these entries. */
export const LANE_HOOK_CONFIG_VERSION = EMDASH_HOOK_CONFIG_VERSION;

const group = (eventType: string, matcher?: string): HookGroup[] => [
  {
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command: makeStdinHookCommand(eventType) }],
  },
];

/**
 * Status hooks for a lane's per-launch `--settings=` file. They post to
 * upstream's hook server with the same commands upstream installs globally
 * (EMDASH_HOOK_PORT / NONCE / PTY_ID come from the PTY env), plus two the
 * spike recommends:
 *
 * - `SessionStart` posts `stop`, which marks the lane `completed`: the input
 *   box is free once first-run dialogs are gone, so a paste can land.
 * - `PermissionRequest` posts `notification`, which marks the lane
 *   `awaiting-input` about 6 s before Claude's own Notification does, so the
 *   dispatcher never pastes into a permission prompt (SEC-15).
 *
 * If the user's global settings also carry upstream's hooks, an event posts
 * twice; the status transitions are idempotent.
 */
export function buildLaneStatusHooks(): Record<string, HookGroup[]> {
  return {
    SessionStart: [
      ...group('session-start'),
      { hooks: [{ type: 'command', command: makeStdinHookCommand('stop') }] },
    ],
    UserPromptSubmit: group('start'),
    PermissionRequest: group('notification', '*'),
    Notification: group('notification'),
    Stop: group('stop'),
  };
}

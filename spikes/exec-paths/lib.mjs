// Shared helpers for the exec-path spike scripts.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
export const STUB_SERVER = join(SPIKE_DIR, 'stub-mcp-server.mjs');

/** Writes a per-lane --mcp-config file pointing at the stub Brain. */
export function writeLaneMcpConfig(path, { laneId, stubLog, alwaysLoad = false }) {
  const config = {
    mcpServers: {
      stub: {
        type: 'stdio',
        command: process.execPath,
        args: [STUB_SERVER],
        env: { LANE_ID: laneId, STUB_LOG: stubLog },
        ...(alwaysLoad ? { alwaysLoad: true } : {}),
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  return config;
}

/** Writes a --settings file registering lane-state hooks and the statusline logger. */
export function writeLaneSettings(path) {
  const hook = { type: 'command', command: `${process.execPath} ${join(SPIKE_DIR, 'hook-logger.mjs')}` };
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Notification',
    'Stop',
    'SessionEnd',
  ];
  const settings = {
    hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [hook] }]])),
    statusLine: { type: 'command', command: `${process.execPath} ${join(SPIKE_DIR, 'statusline-logger.mjs')}` },
  };
  writeFileSync(path, JSON.stringify(settings, null, 2));
  return settings;
}

// Strips CSI/OSC escape sequences so PTY output can be grepped.
export function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>78DEHMc]/g, '');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

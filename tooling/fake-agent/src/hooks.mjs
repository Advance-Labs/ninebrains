// Runs Claude Code-style hooks from a --settings file or JSON string, so lane
// state code can be tested against the fake exactly as against real claude.
// Supports `type: "command"` hooks, tool-name matchers, and exit code 2 = block.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);

export function loadSettings(settingsArg) {
  if (!settingsArg) return {};
  const text = settingsArg.trim().startsWith('{') ? settingsArg : existsSync(settingsArg) ? readFileSync(settingsArg, 'utf8') : null;
  if (text === null) throw new Error(`Settings file not found: ${settingsArg}`);
  return JSON.parse(text);
}

function matches(matcher, toolName) {
  if (!matcher || matcher === '*' || toolName === undefined) return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return matcher === toolName;
  }
}

export class HookRunner {
  constructor({ settings, sessionId, cwd, permissionMode, env }) {
    this.groups = settings?.hooks ?? {};
    this.base = {
      session_id: sessionId,
      transcript_path: join(tmpdir(), 'fake-agent', `${sessionId}.jsonl`),
      cwd,
      permission_mode: permissionMode,
    };
    this.env = env;
  }

  /** Fires every matching hook. Returns { blocked, reason } (PreToolUse only blocks). */
  fire(event, fields = {}) {
    const payload = JSON.stringify({ ...this.base, hook_event_name: event, ...fields });
    let blocked = false;
    const reasons = [];
    for (const group of this.groups[event] ?? []) {
      if (TOOL_EVENTS.has(event) && !matches(group.matcher, fields.tool_name)) continue;
      for (const hook of group.hooks ?? []) {
        if (hook.type !== 'command') continue;
        const res = spawnSync(hook.command, {
          shell: true,
          input: payload,
          env: this.env,
          cwd: this.base.cwd,
          timeout: (hook.timeout ?? 60) * 1000,
          encoding: 'utf8',
        });
        if (res.status === 2) {
          blocked = true;
          reasons.push((res.stderr || '').trim() || `${event} hook blocked`);
        }
      }
    }
    return { blocked, reason: reasons.join('\n') };
  }
}

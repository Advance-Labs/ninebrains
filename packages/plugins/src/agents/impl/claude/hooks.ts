import type { CanonicalHookEvent } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  buildNestedJsonHookConfig,
  configRoots,
  defaultHookEventParser,
  envConfigRoot,
  extractProviderSessionId,
  makeStdinHookCommand,
} from '@emdash/core/services/agent-plugins/api/plugins/helpers';

export const CLAUDE_SETTINGS_PATH = 'settings.json';

/**
 * Claude's Notification events carry no `notification_type` field.
 * Classify by examining the message text:
 *   /permission|approval/i → permission_prompt
 *   everything else        → idle_prompt (agent waiting / done)
 *
 * Every Claude hook payload includes `session_id`, and it changes when the user
 * switches sessions inside the TUI (`/resume`). Status events carry it so the
 * runtime resumes the session Claude is actually in, not the one it launched with.
 */
function parseClaudeHookEvent(
  eventType: string,
  body: Record<string, unknown>
): CanonicalHookEvent {
  if (eventType === 'subagent-start' || eventType === 'subagent-stop') {
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId) return { kind: 'ignore' };
    return { kind: 'subagent', phase: eventType === 'subagent-start' ? 'start' : 'stop', agentId };
  }
  const event =
    eventType === 'notification'
      ? parseClaudeNotification(body)
      : defaultHookEventParser(eventType, body);
  if (event.kind !== 'status') return event;
  const providerSessionId = extractProviderSessionId(body);
  return providerSessionId ? { ...event, providerSessionId } : event;
}

function parseClaudeNotification(body: Record<string, unknown>): CanonicalHookEvent {
  const message = typeof body.message === 'string' ? body.message : '';
  const notificationType = /permission|approval/i.test(message)
    ? ('permission_prompt' as const)
    : ('idle_prompt' as const);
  return {
    kind: 'status',
    type: 'notification',
    notificationType,
    message: message || undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
  };
}

export function buildClaudeHookConfig() {
  return {
    ...buildNestedJsonHookConfig(CLAUDE_SETTINGS_PATH, [
      { hookKey: 'SessionStart', command: makeStdinHookCommand('session-start') },
      { hookKey: 'UserPromptSubmit', command: makeStdinHookCommand('start') },
      { hookKey: 'Notification', command: makeStdinHookCommand('notification') },
      { hookKey: 'Stop', command: makeStdinHookCommand('stop') },
      { hookKey: 'SubagentStart', command: makeStdinHookCommand('subagent-start') },
      { hookKey: 'SubagentStop', command: makeStdinHookCommand('subagent-stop') },
    ]),
    resolveConfigRoots: configRoots(envConfigRoot('CLAUDE_CONFIG_DIR', '.claude')),
    parseHookEvent: parseClaudeHookEvent,
  };
}

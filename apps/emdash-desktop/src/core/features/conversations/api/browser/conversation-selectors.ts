import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import type { AgentStatus } from '@core/primitives/agents/api';
import { isProvisioned, isUnregistered } from '@core/primitives/task-state/browser/task-state';
import type { Task } from '@core/primitives/tasks/api';

export function getConversationsForTask(taskId: string) {
  return conversationRegistry.get(taskId);
}

/**
 * Ninebrains: resolves the workbench tab kind for a conversation the caller only knows by
 * (taskId, conversationId) — e.g. the notification open handler, which has no conversation
 * store in scope. Panes are keyed by (kind, conversationId), so opening the wrong kind
 * ('conversation' for an ACP chat) misses the existing 'acp-chat' tab and spawns a new one.
 * Falls back to 'conversation' when the conversation is not loaded yet.
 */
export function conversationTabKindForTask(
  taskId: string,
  conversationId: string
): 'conversation' | 'acp-chat' {
  const type = conversationRegistry.get(taskId)?.conversations.get(conversationId)?.data.type;
  return type === 'acp' ? 'acp-chat' : 'conversation';
}

export function taskAgentStatus(store: TaskStore): AgentStatus | null {
  return conversationRegistry.get(store.data.id)?.taskStatus ?? null;
}

export function taskConversationStats(store: TaskStore): Record<string, number> {
  if (isUnregistered(store)) return {};
  if (isProvisioned(store)) {
    const manager = conversationRegistry.get(store.data.id);
    if (manager) {
      const counts: Record<string, number> = {};
      for (const conversation of manager.conversations.values()) {
        const id = conversation.data.providerId;
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return counts;
    }
  }
  return (store.data as Task).conversations;
}

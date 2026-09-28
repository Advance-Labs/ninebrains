import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import type { ConversationType } from '@core/primitives/conversations/api';
import { conversationTabKindForTask } from './conversation-selectors';

function managerWith(entries: Record<string, ConversationType>): ConversationManagerStore {
  const conversations = new Map(
    Object.entries(entries).map(([id, type]) => [id, { data: { type } }])
  );
  return { conversations } as unknown as ConversationManagerStore;
}

describe('conversationTabKindForTask', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves acp-chat for an ACP conversation looked up by task and id', () => {
    vi.spyOn(conversationRegistry, 'get').mockReturnValue(managerWith({ 'conv-1': 'acp' }));
    expect(conversationTabKindForTask('task-1', 'conv-1')).toBe('acp-chat');
  });

  it('resolves conversation for a pty conversation', () => {
    vi.spyOn(conversationRegistry, 'get').mockReturnValue(managerWith({ 'conv-1': 'pty' }));
    expect(conversationTabKindForTask('task-1', 'conv-1')).toBe('conversation');
  });

  it('falls back to conversation when the task or conversation is not loaded', () => {
    vi.spyOn(conversationRegistry, 'get').mockReturnValue(undefined);
    expect(conversationTabKindForTask('task-1', 'conv-1')).toBe('conversation');

    vi.spyOn(conversationRegistry, 'get').mockReturnValue(managerWith({ other: 'acp' }));
    expect(conversationTabKindForTask('task-1', 'conv-1')).toBe('conversation');
  });
});

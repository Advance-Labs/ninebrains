import { describe, expect, it, vi } from 'vitest';
import {
  ConversationManagerStore,
  ConversationStore,
} from '@core/features/conversations/api/browser/conversation-manager';
import type { Conversation } from '@core/primitives/conversations/api';

const markConversationSeen = vi.fn();
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: () => Promise.resolve({ markConversationSeen }),
}));

function store(agentStatus: Conversation['agentStatus'], seen: boolean): ConversationStore {
  return new ConversationStore({
    id: 'c1',
    agentStatus,
    agentStatusSeen: seen,
  } as Conversation);
}

function taskStatus(conversations: ConversationStore[]) {
  const get = Object.getOwnPropertyDescriptor(ConversationManagerStore.prototype, 'taskStatus')
    ?.get;
  return get?.call({ conversations: new Map(conversations.map((c, i) => [String(i), c])) });
}

describe('done, unseen status', () => {
  it('shows completed only until the conversation is viewed', async () => {
    const conversation = store('completed', false);
    expect(conversation.indicatorStatus).toBe('completed');
    expect(taskStatus([conversation])).toBe('completed');

    conversation.markSeen();
    await vi.waitFor(() => expect(markConversationSeen).toHaveBeenCalledWith({ conversationId: 'c1' }));
    expect(conversation.indicatorStatus).toBeNull();
    expect(taskStatus([conversation])).toBeNull();
  });

  it('ranks awaiting-input over working over error over completed at task level', () => {
    expect(taskStatus([store('completed', false), store('error', false)])).toBe('error');
    expect(taskStatus([store('error', false), store('working', true)])).toBe('working');
    expect(taskStatus([store('working', true), store('awaiting-input', false)])).toBe(
      'awaiting-input'
    );
  });
});

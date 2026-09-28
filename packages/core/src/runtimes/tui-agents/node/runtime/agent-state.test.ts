import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import {
  createTuiAgentStatesLiveModel,
  createTuiAgentStatesListModel,
  createTuiSessionsLiveModel,
  createTuiSessionsListModel,
  produceCell,
} from '#runtimes/tui-agents/node/state/live-models';
import { TuiAgentStates } from './agent-state';

function createTracker() {
  const sessionsLiveModel = createTuiSessionsLiveModel();
  const agentStatesLiveModel = createTuiAgentStatesLiveModel();
  const sessions = createTuiSessionsListModel(sessionsLiveModel);
  const agentStates = createTuiAgentStatesListModel(agentStatesLiveModel);
  const onSessionIdChanged = vi.fn();
  const onAgentStateChanged = vi.fn();
  const tracker = new TuiAgentStates(
    sessions,
    agentStates,
    () => 1_000,
    onSessionIdChanged,
    onAgentStateChanged
  );
  return { tracker, sessions, agentStates, onSessionIdChanged, onAgentStateChanged };
}

describe('TuiAgentStates', () => {
  it('maps canonical status hook events to agent state', () => {
    const { tracker, agentStates } = createTracker();

    tracker.applyCanonicalEvent('conv-1', 'codex', {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'approve command',
    });

    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      conversationId: 'conv-1',
      providerId: 'codex',
      status: 'awaiting-input',
      source: 'hook',
      notificationType: 'permission_prompt',
      message: 'approve command',
      updatedAt: expect.any(Number),
    });
  });

  it('marks input submitted as working only when the provider lacks a start hook', () => {
    const { tracker, agentStates } = createTracker();

    tracker.markInputSubmitted('conv-1', { hooks: { kind: 'none' } }, '\r');
    expect(peek(agentStates.states.list)['conv-1']?.status).toBe('working');

    tracker.markInputSubmitted(
      'conv-2',
      { hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] } },
      '\r'
    );
    expect(peek(agentStates.states.list)['conv-2']).toBeUndefined();
  });

  it('publishes valid provider session ids through the sessions model', () => {
    const { tracker, sessions, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'amp',
        sessionId: null,
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'amp', {
      kind: 'session',
      providerSessionId: 'T-123',
    });

    expect(peek(sessions.states.list)['conv-1']?.sessionId).toBe('T-123');
    expect(onSessionIdChanged).toHaveBeenCalledWith('conv-1', 'T-123');
  });

  it('adopts a provider session id carried on a status event', () => {
    const { tracker, sessions, agentStates, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'claude',
        sessionId: 'conv-1',
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'start',
      providerSessionId: 'resumed-session',
    });

    expect(peek(sessions.states.list)['conv-1']?.sessionId).toBe('resumed-session');
    expect(onSessionIdChanged).toHaveBeenCalledWith('conv-1', 'resumed-session');
    expect(peek(agentStates.states.list)['conv-1']?.status).toBe('working');
  });

  it('does not re-publish an unchanged session id carried on status events', () => {
    const { tracker, sessions, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'claude',
        sessionId: 'conv-1',
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'start',
      providerSessionId: 'conv-1',
    });
    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'stop',
      providerSessionId: 'conv-1',
    });

    expect(onSessionIdChanged).not.toHaveBeenCalled();
  });

  it('markOutputActivity promotes idle to working for a provider without a start hook', () => {
    const { tracker, agentStates } = createTracker();

    tracker.markOutputActivity('conv-1', 'codex', { hooks: { kind: 'none' } });

    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      status: 'working',
      source: 'output',
      providerId: 'codex',
    });
  });

  it('markOutputActivity is a no-op for a provider whose start hook owns working', () => {
    const { tracker, agentStates } = createTracker();

    tracker.markOutputActivity('conv-1', 'claude', {
      hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] },
    });

    expect(peek(agentStates.states.list)['conv-1']).toBeUndefined();
  });

  it('markOutputActivity never overrides awaiting-input or error', () => {
    const { tracker, agentStates } = createTracker();

    for (const status of ['awaiting-input', 'error'] as const) {
      const conversationId = `conv-${status}`;
      tracker.applyCanonicalEvent(conversationId, 'codex', {
        kind: 'status',
        type: status === 'error' ? 'error' : 'notification',
        notificationType: status === 'awaiting-input' ? 'permission_prompt' : undefined,
      });
      tracker.markOutputActivity(conversationId, 'codex', { hooks: { kind: 'none' } });
      expect(peek(agentStates.states.list)[conversationId]?.status).toBe(status);
    }
  });

  it('markOutputActivity does not clobber an existing working state (keeps hook metadata)', () => {
    const { tracker, agentStates } = createTracker();

    tracker.applyCanonicalEvent('conv-1', 'codex', {
      kind: 'status',
      type: 'start',
      title: 'Editing files',
    });
    tracker.markOutputActivity('conv-1', 'codex', { hooks: { kind: 'none' } });

    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      status: 'working',
      source: 'hook',
      title: 'Editing files',
    });
  });

  it('resetIdleIfWorking clears a stale working but leaves awaiting-input alone', () => {
    const { tracker, agentStates } = createTracker();

    tracker.applyCanonicalEvent('working-conv', 'claude', { kind: 'status', type: 'start' });
    tracker.resetIdleIfWorking('working-conv');
    expect(peek(agentStates.states.list)['working-conv']?.status).toBe('idle');

    tracker.applyCanonicalEvent('await-conv', 'claude', {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
    });
    tracker.resetIdleIfWorking('await-conv');
    expect(peek(agentStates.states.list)['await-conv']?.status).toBe('awaiting-input');
  });
});

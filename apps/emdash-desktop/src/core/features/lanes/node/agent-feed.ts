import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { tuiAgentsContract, type TuiAgentStateStatus } from '@emdash/core/runtimes/tui-agents/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import type { LaneAgentFeedPort } from './lane-ports';
import type { TuiSessionStatus } from './lane-status';

/**
 * Subscribes to the local TUI runtime's hook-driven `agentStates` and its
 * `sessions` list, the same sources as the upstream agent-status bridge.
 * Local host only (v0.1 lanes are local-only).
 */
export function createTuiAgentFeed(options: {
  runtimes: Pick<RuntimeBroker, 'client'>;
  onError(context: string, error: unknown): void;
}): LaneAgentFeedPort {
  return {
    subscribe(listener) {
      const scope = createScope({ label: 'lanes:agent-feed' });
      let agents = new Map<string, TuiAgentStateStatus>();
      let sessions = new Map<string, TuiSessionStatus>();
      const notify = () => listener({ agents, sessions });

      void (async () => {
        const client = await options.runtimes.client(LOCAL_HOST_REF);
        if (!client.success || scope.disposed) return;
        const remoteOptions = { scope, lingerMs: 15_000 };
        const agentStates = remote(
          tuiAgentsContract.agentStates,
          client.data.tuiAgents.agentStates,
          remoteOptions
        )(undefined).states.list;
        const sessionList = remote(
          tuiAgentsContract.sessions,
          client.data.tuiAgents.sessions,
          remoteOptions
        )(undefined).states.list;
        observe(
          agentStates,
          (next) => {
            if (next.status === 'loading') return;
            agents = new Map(
              Object.values(next.value ?? {}).map((state) => [state.conversationId, state.status])
            );
            notify();
          },
          { scope }
        );
        observe(
          sessionList,
          (next) => {
            if (next.status === 'loading') return;
            sessions = new Map(
              Object.values(next.value ?? {}).map((session) => [
                session.conversationId,
                session.status,
              ])
            );
            notify();
          },
          { scope }
        );
      })().catch((error: unknown) => options.onError('lanes: agent feed failed', error));

      return () => void scope.dispose();
    },
  };
}

import {
  Brain,
  type BrainGrant,
  type BrainRequest,
  type BrainResponse,
  SqliteBrainStore,
  createHttpBrainClient,
  executeBrainRequest,
} from '@ninebrains/brain-core';
import type { BrainMcpConfig } from './config';

/** Where tool calls go. Both implementations speak the same brain-core contract. */
export interface BrainBackend {
  call(request: BrainRequest): Promise<BrainResponse>;
  close(): void;
}

/** Forward mode: POST to the app's main process over localhost with the lane's token. */
export function forwardBackend(url: string, token: string): BrainBackend {
  const client = createHttpBrainClient({ url, token });
  return { call: (request) => client.call(request), close: () => {} };
}

/** Direct mode: run the request in-process against a Brain this process owns (or shares, in tests). */
export function directBackend(brain: Brain, grant: BrainGrant, options: { ownsBrain?: boolean } = {}): BrainBackend {
  return {
    call: async (request) => executeBrainRequest(brain, grant, request),
    close: () => {
      if (options.ownsBrain) brain.close();
    },
  };
}

export function openBackend(config: BrainMcpConfig): BrainBackend {
  if (config.mode === 'forward') return forwardBackend(config.url, config.token);
  const brain = new Brain({ store: SqliteBrainStore.open(config.dbPath) });
  return directBackend(brain, config.grant, { ownsBrain: true });
}

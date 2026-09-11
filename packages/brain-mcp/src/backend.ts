import {
  type BrainRequest,
  type BrainResponse,
  createHttpBrainClient,
} from '@ninebrains/brain-core';

/** Where tool calls go. */
export interface BrainBackend {
  call(request: BrainRequest): Promise<BrainResponse>;
  close(): void;
}

/**
 * The only backend the shim ships with (SEC-01): every call is POSTed to
 * main over 127.0.0.1 with this session's token. Main is the only process
 * that opens the Brain DB, and it decides identity from the token.
 */
export function forwardBackend(options: {
  url: string;
  token: string;
  laneHint?: string | null;
  timeoutMs?: number;
}): BrainBackend {
  const client = createHttpBrainClient({
    url: options.url,
    token: options.token,
    laneHint: options.laneHint ?? undefined,
    timeoutMs: options.timeoutMs,
  });
  return { call: (request) => client.call(request), close: () => {} };
}

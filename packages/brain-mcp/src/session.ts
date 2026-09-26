import { BRAIN_PROTOCOL_VERSION, whoamiSchema } from '@ninebrains/brain-core';
import type { BrainBackend } from './backend';
import type { Role } from './tools';

export interface Session {
  role: Role;
  laneId?: string;
  brainId?: string;
  projectId: string | null;
  runId?: string;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

const RETRYABLE = new Set(['UNAVAILABLE', 'RATE_LIMITED']);

/**
 * SEC-02: asks main who this token belongs to, so the shim exposes the right
 * tools. The answer only shapes the tool list: main authorizes every call
 * from the token again. Retries while the app is starting (UNAVAILABLE) or
 * busy (RATE_LIMITED); fails at once on anything else, such as a revoked
 * token or a lane hint that does not match.
 */
export async function discoverSession(
  backend: BrainBackend,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<Session> {
  const attempts = options.attempts ?? 10;
  const delayMs = options.delayMs ?? 1_000;
  let last = 'no response';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await backend.call({ v: BRAIN_PROTOCOL_VERSION, op: 'whoami', args: {} });
    if (response.ok) {
      const parsed = whoamiSchema.safeParse(response.result);
      if (!parsed.success)
        throw new SessionError('the Brain endpoint returned a malformed whoami result');
      // SEC-01/SEC-02: the shim serves agents. A user token belongs to the operator's
      // CLI and carries the host ops, which no agent may reach, so a user answer means
      // the wrong token reached this launch. Fail closed rather than pick a tool list.
      if (parsed.data.role === 'user') {
        throw new SessionError(
          'this token is a user token; brain-mcp serves lanes and Brains only'
        );
      }
      return { ...parsed.data, role: parsed.data.role };
    }
    last = `${response.error.code}: ${response.error.message}`;
    if (!RETRYABLE.has(response.error.code)) break;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new SessionError(`cannot start the Brain session (${last})`);
}

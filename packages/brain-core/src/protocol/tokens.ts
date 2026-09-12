import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertId } from '../ids';
import type { ProjectId } from '../types';
import type { BrainGrant } from './execute';

/** 32 random bytes, base64url without padding: 43 characters, 256 bits. */
export const TOKEN_BYTES = 32;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * SEC-02 / SEC-03: the only source of identity for the Brain endpoint.
 *
 * - Main mints one token per lane or Brain launch and puts it only in that
 *   launch's MCP entry. The grant (role, laneId or brainId, projectId,
 *   attachment roots, optional runId) lives here, never in the request.
 * - Only SHA-256 digests are stored, so the raw token is never kept, logged
 *   or serialized by the registry.
 * - `resolve` compares fixed-length digests with `timingSafeEqual` against
 *   every entry, with no early exit and no throw on a malformed token.
 */
export class TokenRegistry {
  private readonly entries: Array<{ digest: Buffer; grant: Readonly<BrainGrant> }> = [];

  /** Mints a token bound to `grant`. Revoke it when the lane stops, relaunches or its run ends. */
  issue(grant: BrainGrant): string {
    const identity = grant.identity;
    if (identity.role === 'lane') {
      assertId('laneId', identity.laneId);
      assertId('projectId', identity.projectId);
    } else {
      assertId('brainId', identity.brainId);
    }
    if (grant.projectId !== null) assertId('projectId', grant.projectId);
    if (grant.runId !== undefined) assertId('runId', grant.runId);

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    this.entries.push({
      digest: digest(token),
      grant: Object.freeze({ ...grant, attachmentRoots: [...grant.attachmentRoots] }),
    });
    return token;
  }

  /** The grant for a presented token, or null. Never throws, whatever it is given. */
  resolve(presented: unknown): Readonly<BrainGrant> | null {
    const candidate = digest(typeof presented === 'string' ? presented : '');
    let found: Readonly<BrainGrant> | null = null;
    for (const entry of this.entries) {
      if (
        timingSafeEqual(entry.digest, candidate) &&
        typeof presented === 'string' &&
        presented.length > 0
      ) {
        found ??= entry.grant;
      }
    }
    return found;
  }

  revoke(token: string): boolean {
    const target = digest(token);
    const index = this.entries.findIndex((entry) => timingSafeEqual(entry.digest, target));
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  /** Revokes every token whose grant matches, e.g. all tokens of a lane that stopped. Returns the count. */
  revokeWhere(predicate: (grant: Readonly<BrainGrant>) => boolean): number {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (predicate(this.entries[i]!.grant)) {
        this.entries.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /**
   * The project of a live Brain grant with this brainId (null when that grant has no project),
   * or undefined when no such Brain holds a token. Feeds `ExecuteOptions.resolveBrainProject`.
   */
  brainProject(brainId: string): ProjectId | null | undefined {
    for (const { grant } of this.entries) {
      if (grant.identity.role === 'brain' && grant.identity.brainId === brainId) {
        return grant.projectId;
      }
    }
    return undefined;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Keeps digests and grants out of logs and JSON dumps. */
  toJSON(): { tokens: number } {
    return { tokens: this.entries.length };
  }
}

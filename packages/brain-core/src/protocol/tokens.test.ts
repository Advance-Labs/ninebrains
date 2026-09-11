import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BRAIN } from '../../test/helpers';
import { InvalidInputError } from '../errors';
import type { BrainGrant } from './execute';
import { createTokenBucketLimiter } from './rate-limit';
import { TokenRegistry } from './tokens';

const laneA: BrainGrant = {
  identity: { role: 'lane', laneId: 'A', projectId: 'p1' },
  projectId: 'p1',
  attachmentRoots: ['/w'],
};
const laneB: BrainGrant = {
  identity: { role: 'lane', laneId: 'B', projectId: 'p1' },
  projectId: 'p1',
  attachmentRoots: ['/w'],
};
const hub: BrainGrant = { identity: BRAIN, projectId: 'p1', attachmentRoots: [] };

describe('SEC-03 token lifecycle', () => {
  it('mints 256-bit base64url tokens, all distinct', () => {
    const tokens = new TokenRegistry();
    const minted = Array.from({ length: 50 }, () => tokens.issue(laneA));
    for (const token of minted) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(minted).size).toBe(50);
  });

  it('resolves a live token to exactly its grant', () => {
    const tokens = new TokenRegistry();
    const a = tokens.issue(laneA);
    const b = tokens.issue(laneB);
    expect(tokens.resolve(a)?.identity).toEqual(laneA.identity);
    expect(tokens.resolve(b)?.identity).toEqual(laneB.identity);
  });

  it('rejects a revoked token', () => {
    const tokens = new TokenRegistry();
    const token = tokens.issue(laneA);
    expect(tokens.revoke(token)).toBe(true);
    expect(tokens.resolve(token)).toBeNull();
    expect(tokens.revoke(token)).toBe(false);
  });

  it.each([undefined, null, 42, {}, '', 'short', 'x'.repeat(10_000), 'Bearer abc'])(
    'returns null without throwing for %j',
    (presented) => {
      const tokens = new TokenRegistry();
      tokens.issue(laneA);
      expect(() => tokens.resolve(presented)).not.toThrow();
      expect(tokens.resolve(presented)).toBeNull();
    }
  );

  it('revokes every token of a lane that stopped', () => {
    const tokens = new TokenRegistry();
    const a1 = tokens.issue(laneA);
    const a2 = tokens.issue(laneA);
    const b = tokens.issue(laneB);
    expect(tokens.revokeWhere((g) => g.identity.role === 'lane' && g.identity.laneId === 'A')).toBe(
      2
    );
    expect([tokens.resolve(a1), tokens.resolve(a2)]).toEqual([null, null]);
    expect(tokens.resolve(b)).not.toBeNull();
  });

  it('never keeps or prints the raw token', () => {
    const tokens = new TokenRegistry();
    const token = tokens.issue(hub);
    expect(JSON.stringify(tokens)).not.toContain(token);
    expect(inspect(tokens, { depth: 10 })).not.toContain(token);
  });

  it('refuses grants whose ids are not safe path segments', () => {
    const tokens = new TokenRegistry();
    expect(() =>
      tokens.issue({ ...laneA, identity: { role: 'lane', laneId: '..', projectId: 'p1' } })
    ).toThrow(InvalidInputError);
    expect(() => tokens.issue({ ...hub, identity: { role: 'brain', brainId: 'a:b' } })).toThrow(
      InvalidInputError
    );
    expect(() => tokens.issue({ ...laneA, runId: 'a/b' })).toThrow(InvalidInputError);
  });

  it('grants are frozen copies', () => {
    const tokens = new TokenRegistry();
    const roots = ['/w'];
    const token = tokens.issue({ ...laneA, attachmentRoots: roots });
    roots.push('/etc');
    expect(tokens.resolve(token)?.attachmentRoots).toEqual(['/w']);
    expect(Object.isFrozen(tokens.resolve(token))).toBe(true);
  });
});

describe('SEC-06 rate limit', () => {
  it('allows a burst of 60, then 20 per second', () => {
    let clock = 0;
    const limiter = createTokenBucketLimiter({ now: () => clock });
    const key = {};
    const burst = Array.from({ length: 100 }, () => limiter.take(key));
    expect(burst.filter(Boolean)).toHaveLength(60);
    clock += 1_000;
    expect(Array.from({ length: 30 }, () => limiter.take(key)).filter(Boolean)).toHaveLength(20);
  });

  it('keeps separate budgets per key', () => {
    const limiter = createTokenBucketLimiter({ burst: 1, now: () => 0 });
    const a = {};
    const b = {};
    expect([limiter.take(a), limiter.take(a), limiter.take(b)]).toEqual([true, false, true]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatesProjectPrefsSchema } from '../../contributions/mementos';

// Migration tests for the versioned gates project-prefs schema, per the
// versioned-schema conventions: every stored shape must upgrade to the latest
// version without data loss, and in production (VersionedSchema.safeParse
// skips dev-only validation, but still runs the upgrade chain for any
// resolved version that is not the latest).
describe('gatesProjectPrefsSchema versioned schema', () => {
  it('upgrades a v1 row to v2 with allowNetwork/allowUnsandboxed explicitly false', () => {
    const result = gatesProjectPrefsSchema.safeParse({
      version: '1',
      testingRigor: 7,
      securityRigor: null,
      testCommand: 'pnpm test',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.version).toBe('2');
    expect(result.data.testingRigor).toBe(7);
    expect(result.data.testCommand).toBe('pnpm test');
    expect(result.data.allowNetwork).toBe(false);
    expect(result.data.allowUnsandboxed).toBe(false);
  });

  describe('SEC-08: a legacy v1 row reads with both flags strictly false in production', () => {
    let previousNodeEnv: string | undefined;

    beforeEach(() => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it('parseJson on a stored v1 blob never leaves the flags undefined', () => {
      // A v1 memento row written before this change: no allowNetwork/allowUnsandboxed keys at
      // all. `VersionedSchema.safeParse` only validates a resolved version's *own* schema in
      // dev, but a v1 row is never the latest version once this schema is at v2, so it always
      // runs the '2' `up()` migration — in dev and in production alike — which sets both fields
      // explicitly rather than relying on a schema default that a production fast path could skip.
      const legacyV1Json = JSON.stringify({
        version: '1',
        testingRigor: null,
        securityRigor: null,
        testCommand: null,
      });
      const parsed = gatesProjectPrefsSchema.parseJson(legacyV1Json);
      expect(parsed).not.toBeNull();
      expect(parsed?.allowNetwork).toBe(false);
      expect(parsed?.allowUnsandboxed).toBe(false);
      // Guard the exact failure mode this test targets: `=== false`, not just falsy/undefined.
      expect(Object.hasOwn(parsed as object, 'allowNetwork')).toBe(true);
      expect(Object.hasOwn(parsed as object, 'allowUnsandboxed')).toBe(true);
    });

    it('a v2 row already at the latest version still round-trips both flags in production', () => {
      const v2Json = JSON.stringify({
        version: '2',
        testingRigor: null,
        securityRigor: null,
        testCommand: null,
        allowNetwork: true,
        allowUnsandboxed: false,
      });
      const parsed = gatesProjectPrefsSchema.parseJson(v2Json);
      expect(parsed).toEqual({
        version: '2',
        testingRigor: null,
        securityRigor: null,
        testCommand: null,
        allowNetwork: true,
        allowUnsandboxed: false,
      });
    });
  });
});

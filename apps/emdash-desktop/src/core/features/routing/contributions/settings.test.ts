import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING_SETTINGS, routingSettingsSchema } from './settings';

/**
 * T47 (`docs/plans/2026-09-15-routing-usability.md`): `profilesEnabled` replaces the old
 * build-time `MODEL_PROFILES_ENABLED` flag as Lever B's real on/off switch. The generic
 * `SettingsStore` round-trip test (`settings-store.test.ts`'s `round-trips the ninebrains.routing
 * contribution defaults`) already exercises the merge/parse mechanics for every settings key,
 * this one — so this file only pins the default. The SEC-08 boundary check (agents cannot reach
 * this setting) lives in `../node/routing-service.test.ts` instead, not here: this file sits
 * under `contributions/`, which `tsconfig.browser.json` includes (it is not a `node/` path), and
 * `@ninebrains/brain-core`'s "development" export resolves to its Node-only source — importing it
 * from a browser-reachable file pulls that source into the renderer program, which has no Node
 * types, and fails to typecheck. `gates/node/project-prefs-service.test.ts` keeps the same check
 * under `node/` for exactly this reason; this file follows that precedent.
 */
describe('ninebrains.routing settings', () => {
  it('profilesEnabled defaults to false: a packaged build ships with profiles off', () => {
    expect(DEFAULT_ROUTING_SETTINGS.profilesEnabled).toBe(false);
    expect(routingSettingsSchema.parse(DEFAULT_ROUTING_SETTINGS)).toEqual(DEFAULT_ROUTING_SETTINGS);
  });

  it('accepts a profile-shaped id for reviewerProfileId independent of profilesEnabled', () => {
    const parsed = routingSettingsSchema.parse({
      profilesEnabled: true,
      reviewerProfileId: 'p1',
    });
    expect(parsed).toEqual({ profilesEnabled: true, reviewerProfileId: 'p1' });
  });
});

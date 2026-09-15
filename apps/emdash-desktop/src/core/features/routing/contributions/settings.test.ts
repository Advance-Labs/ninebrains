import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING_SETTINGS, routingSettingsSchema } from './settings';

/**
 * T47 (`docs/plans/2026-09-15-routing-usability.md`): `profilesEnabled` replaces the old
 * build-time `MODEL_PROFILES_ENABLED` flag as Lever B's real on/off switch. The generic
 * `SettingsStore` round-trip test (`settings-store.test.ts`'s `round-trips the ninebrains.routing
 * contribution defaults`) already exercises the merge/parse mechanics for every settings key,
 * this one — so this file only pins the two things specific to routing: the default, and that
 * agents cannot reach it.
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

  describe('SEC-08: agent identities cannot reach this setting', () => {
    it('has no counterpart in the Brain protocol op vocabulary', async () => {
      // ninebrains.routing (profilesEnabled and reviewerProfileId alike) is registered only as
      // the renderer's app-settings wire domain (manifests/node/controllers.ts). Agents and
      // Brain sessions act only through brain-core's BrainOp surface, which has no op that can
      // read or write app settings at all — a lane or Brain token can only ever *ask* over
      // LANE_OPS/BRAIN_OPS/SESSION_OPS (brain-core/src/protocol/ops.ts). This test pins that
      // vocabulary so an op cannot be added there silently, the same convention
      // project-prefs-service.test.ts uses for the gates settings boundary.
      const { BRAIN_OPS, LANE_OPS, SESSION_OPS } = await import('@ninebrains/brain-core');
      const allOps = new Set<string>([...BRAIN_OPS, ...LANE_OPS, ...SESSION_OPS]);
      for (const forbidden of [
        'setProfilesEnabled',
        'updateAppSettings',
        'setAppSettings',
        'setRoutingSettings',
        'setReviewerProfileId',
      ]) {
        expect(allOps.has(forbidden)).toBe(false);
      }
    });
  });
});

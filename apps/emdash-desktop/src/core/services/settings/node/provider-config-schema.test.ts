import { describe, expect, it } from 'vitest';
import { providerCustomConfigEntrySchema } from './provider-config-schema';

describe('provider config schema: skipPlugins', () => {
  it('accepts plugin ids and rejects anything that could be a flag or JSON', () => {
    expect(
      providerCustomConfigEntrySchema.safeParse({ skipPlugins: ['a@m', 'b.c@m-2'] }).success
    ).toBe(true);
    for (const bad of ['--dangerously-skip-permissions', 'x"}@y', 'no-at-sign', 'a@m\nb@m']) {
      expect(providerCustomConfigEntrySchema.safeParse({ skipPlugins: [bad] }).success).toBe(false);
    }
  });

  it('caps the list', () => {
    const many = Array.from({ length: 101 }, (_, i) => `p${i}@m`);
    expect(providerCustomConfigEntrySchema.safeParse({ skipPlugins: many }).success).toBe(false);
  });
});

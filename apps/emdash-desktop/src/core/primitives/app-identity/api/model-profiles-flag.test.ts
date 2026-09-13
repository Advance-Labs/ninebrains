import { describe, expect, it } from 'vitest';
import { MODEL_PROFILES_ENABLED } from './fork-flags';

describe('MODEL_PROFILES_ENABLED', () => {
  it('tracks import.meta.env.DEV: on in dev, off in a release build', () => {
    expect(MODEL_PROFILES_ENABLED).toBe(import.meta.env.DEV);
  });

  it('is a boolean, not the raw env value', () => {
    expect(typeof MODEL_PROFILES_ENABLED).toBe('boolean');
  });
});

import { describe, expect, it } from 'vitest';
import { nextFocusRegion, type FocusRegion } from './focus-regions';

const all: FocusRegion[] = ['sidebar', 'main', 'bottom', 'right'];

describe('nextFocusRegion', () => {
  it('walks forward and wraps', () => {
    expect(nextFocusRegion(all, 'sidebar', 1)).toBe('main');
    expect(nextFocusRegion(all, 'main', 1)).toBe('bottom');
    expect(nextFocusRegion(all, 'right', 1)).toBe('sidebar');
  });

  it('walks backward and wraps', () => {
    expect(nextFocusRegion(all, 'main', -1)).toBe('sidebar');
    expect(nextFocusRegion(all, 'sidebar', -1)).toBe('right');
  });

  it('skips regions that are not visible', () => {
    expect(nextFocusRegion(['sidebar', 'main', 'right'], 'main', 1)).toBe('right');
    expect(nextFocusRegion(['sidebar', 'main', 'right'], 'right', -1)).toBe('main');
  });

  it('starts at either end when nothing known is focused', () => {
    expect(nextFocusRegion(all, null, 1)).toBe('sidebar');
    expect(nextFocusRegion(all, null, -1)).toBe('right');
    expect(nextFocusRegion(['main'], 'bottom', 1)).toBe('main');
  });

  it('returns null with no regions', () => {
    expect(nextFocusRegion([], null, 1)).toBeNull();
  });
});

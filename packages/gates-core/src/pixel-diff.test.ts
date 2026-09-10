import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pixelDiff } from './pixel-diff';
import { solidPng } from './test-utils';

describe('pixelDiff', () => {
  it('reports zero difference for identical images', () => {
    const a = solidPng(20, 10, [10, 120, 200]);
    const result = pixelDiff(a, solidPng(20, 10, [10, 120, 200]));
    expect(result).toMatchObject({
      width: 20,
      height: 10,
      diffPixels: 0,
      totalPixels: 200,
      ratio: 0,
    });
    expect(result.sizeMismatch).toBe(false);
  });

  it('counts a changed region and returns a readable diff PNG', () => {
    const base = solidPng(20, 10);
    const changed = solidPng(20, 10, [255, 255, 255], { x: 0, y: 0, w: 5, h: 4, rgb: [0, 0, 0] });
    const result = pixelDiff(base, changed);
    expect(result.diffPixels).toBe(20);
    expect(result.ratio).toBeCloseTo(0.1);
    const diff = PNG.sync.read(Buffer.from(result.diffPng!));
    expect([diff.width, diff.height]).toEqual([20, 10]);
  });

  it('ignores differences under the colour threshold', () => {
    const base = solidPng(8, 8, [100, 100, 100]);
    const nudged = solidPng(8, 8, [101, 100, 100]);
    expect(pixelDiff(base, nudged, { threshold: 0.1 }).diffPixels).toBe(0);
    expect(pixelDiff(base, nudged, { threshold: 0 }).diffPixels).toBe(64);
  });

  it('reports a size change as a full mismatch instead of throwing', () => {
    const result = pixelDiff(solidPng(10, 10), solidPng(12, 10));
    expect(result).toMatchObject({ sizeMismatch: true, ratio: 1, width: 12, height: 10 });
    expect(result.diffPng).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  animationsEnabled,
  formatElapsed,
  pulseOn,
  shimmerLevels,
  spinnerFrame,
  SPINNER_FRAMES,
} from '../src/tui/motion';

describe('motion', () => {
  it('turns off without a TTY or with NINEBRAINS_REDUCED_MOTION', () => {
    expect(animationsEnabled({}, true)).toBe(true);
    expect(animationsEnabled({}, false)).toBe(false);
    expect(animationsEnabled({ NINEBRAINS_REDUCED_MOTION: '1' }, true)).toBe(false);
    expect(animationsEnabled({ NINEBRAINS_REDUCED_MOTION: '0' }, true)).toBe(true);
  });

  it('steps the spinner every 100 ms and wraps', () => {
    expect(spinnerFrame(0)).toBe('⠋');
    expect(spinnerFrame(99)).toBe('⠋');
    expect(spinnerFrame(100)).toBe('⠙');
    expect(spinnerFrame(100 * SPINNER_FRAMES.length)).toBe('⠋');
  });

  it('sweeps one bright band across the text every two seconds', () => {
    const at = (ms: number) => shimmerLevels(7, ms);
    // The band starts left of the text, so the first frame is dark.
    expect(at(0).every((level) => level === 0)).toBe(true);
    // Mid-sweep the peak sits on the text and falls off on both sides.
    const mid = at(1_000);
    const peak = Math.max(...mid);
    expect(peak).toBeGreaterThan(0.9);
    expect(mid.every((level) => level >= 0 && level <= 1)).toBe(true);
    // Two seconds later it is the same frame.
    expect(at(2_000 + 1_000)).toEqual(mid);
  });

  it('breathes the dot in 600 ms halves', () => {
    expect([0, 599, 600, 1_199, 1_200].map(pulseOn)).toEqual([true, true, false, false, true]);
  });

  it('formats elapsed time like Codex', () => {
    expect([0, 59_999, 60_000, 3_723_000].map(formatElapsed)).toEqual([
      '0s',
      '59s',
      '1m 00s',
      '1h 02m 03s',
    ]);
  });
});

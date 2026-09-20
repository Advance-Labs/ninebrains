/**
 * Dark theme — the default emdash dark palette.
 *
 * Tuned to stay visually close to the current Radix-sourced emdark palette:
 *   - Neutral: near-black background (OKLCH L ~0.178), very low chroma
 *   - Accent: monochrome (Ninebrains): an explicit black-and-white ramp, see `scales` below
 *   - Hue scales: green, red, amber, blue, orange, purple (dark polarity)
 *   - Background anchored at neutral.1 dark OKLCH L (~0.178)
 */

import { defineTheme } from '../core/index';

export const darkTheme = defineTheme({
  id: 'dark',
  label: 'Dark',
  polarity: 'dark',

  // Superseded by the explicit monochrome `scales.accent` below; kept so the generator
  // still has a seed for anything that asks for the accent hue.
  accent: { hue: 0, chroma: 0 },
  neutral: { hue: 0, chroma: 0.002 },

  hues: {
    green: 147,
    red: 23,
    amber: 81,
    blue: 252,
    orange: 55,
    purple: 305,
  },

  contrast: 'normal',
  chroma: 1.15,
  background: { lightness: 0.178 },
  gamut: 'p3',

  tweaks: {
    amber: {
      darkForeground: true,
      steps: {
        9: { l: +0.05 },
        10: { l: +0.04 },
        11: { l: -0.01 },
      },
    },
  },

  /**
   * Ninebrains: the accent is monochrome, mirroring the light theme. The solid step inverts to
   * near-white with black text, which is the dark-mode half of the primary button.
   */
  scales: {
    accent: {
      steps: [
        '#0b0b0b', // 1  app background
        '#111111', // 2  subtle background
        '#1c1c1c', // 3  component background / selected row
        '#232323', // 4  hover
        '#2a2a2a', // 5  active
        '#333333', // 6  subtle border
        '#555555', // 7  ui border / button border
        '#8a8a8a', // 8  strong border / focused lane
        '#fafafa', // 9  solid: the primary button
        '#ffffff', // 10 hovered solid
        '#a1a1a1', // 11 low-contrast text
        '#ededed', // 12 high-contrast text
      ],
      contrast: '#000000',
    },
  },

  syntax: { generate: true },
});

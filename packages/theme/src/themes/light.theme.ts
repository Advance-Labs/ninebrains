/**
 * Light theme — the default emdash light palette.
 *
 * Tuned to stay visually close to the current Radix-sourced emlight palette:
 *   - Neutral: pure gray (hue 0, very low chroma)
 *   - Accent: monochrome (Ninebrains): an explicit black-and-white ramp, see `scales` below
 *   - Hue scales: green, red, amber, blue, orange, purple
 *   - Background lightness anchored to the current neutral.1 OKLCH L (~0.991)
 */

import { defineTheme } from '../core/index';

export const lightTheme = defineTheme({
  id: 'light',
  label: 'Light',
  polarity: 'light',

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
  background: { lightness: 0.991 },
  gamut: 'p3',

  // Amber sits at a gamut cusp: vivid yellow/amber lives at high L. This is a
  // property of the hue, so the tweak is keyed to the `amber` scale itself.
  // Use dark foreground on the solid step and nudge step lightness slightly.
  tweaks: {
    amber: {
      darkForeground: true,
      steps: {
        9: { l: +0.03 },
        10: { l: +0.02 },
        11: { l: -0.02 },
      },
    },
  },

  /**
   * Ninebrains: the accent is monochrome. It drives the primary button, the selected-row tint
   * (step 3) and the focused-lane border (step 8), so it is supplied explicitly rather than
   * generated: steps 9 and 10 are a near-black solid with white text, and step 8 is pushed well
   * past the neutral border so "focused" still reads without colour.
   */
  scales: {
    accent: {
      steps: [
        '#fcfcfc', // 1  app background
        '#f7f7f7', // 2  subtle background
        '#f0f0f0', // 3  component background / selected row
        '#e8e8e8', // 4  hover
        '#e0e0e0', // 5  active
        '#d6d6d6', // 6  subtle border
        '#c6c6c6', // 7  ui border / button border
        '#737373', // 8  strong border / focused lane
        '#171717', // 9  solid: the primary button
        '#000000', // 10 hovered solid
        '#525252', // 11 low-contrast text
        '#171717', // 12 high-contrast text
      ],
      contrast: '#ffffff',
    },
  },

  syntax: { generate: true },
});

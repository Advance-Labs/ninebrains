/**
 * Hardstyle theme — the one deliberate exception to "Ninebrains is black and white."
 *
 * An opt-in, off-by-default alternate for people who want a maximal, neon, high-energy
 * look instead of the flat monochrome default. Documented as a named exception in
 * advance-labs' DESIGN.md and `docs/operating-system/systems/17-agent-status-indicators.md`
 * (Ninebrains-only, never the default, never leaking into other themes or the site).
 *
 * OLED-dark background so the neon accents actually glow, high contrast text, and a wider
 * gamut so the hues stay vivid instead of getting crushed toward gray.
 */

import { defineTheme } from '../core/index';

export const hardstyleTheme = defineTheme({
  id: 'hardstyle',
  label: 'Hardstyle',
  polarity: 'dark',

  // Signature neon magenta/pink accent.
  accent: '#ff2ec4',
  neutral: { hue: 300, chroma: 0.01 },

  hues: {
    green: '#39ff14', // neon green
    red: '#ff003c', // neon red
    amber: '#ffea00', // neon yellow
    blue: '#00e5ff', // electric cyan
    orange: '#ff6a00', // neon orange
    purple: '#b026ff', // neon violet
  },

  contrast: 'high',
  chroma: 1.4,
  background: { lightness: 0.09 },
  gamut: 'p3',

  surfaceLightness: {
    sunken: 0.06,
    base: 0.09,
    'base-emphasis': 0.11,
    elevated: 0.13,
    'elevated-emphasis': 0.16,
    paper: 0.09,
  },

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

  syntax: { generate: true },
});

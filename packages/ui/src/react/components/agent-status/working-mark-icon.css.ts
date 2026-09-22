import { keyframes, style } from '@vanilla-extract/css';
import '@styles/layers.css';

// ── Timing ──────────────────────────────────────────────────────────────────
//
// The eight arm squares take turns lighting up around the ring (one full lap
// per PERIOD_MS); the core pulses on its own, faster cycle so the centre reads
// as the thing doing the thinking while the arms take turns carrying it out.

const ARMS = 8;
const RING_PERIOD_MS = 1600;
const CORE_PERIOD_MS = 800;

// Same fade curve as segmented-spinner: a bright head with a soft tail, no
// segment ever fully disappears so the mark's shape stays legible at rest.
const armFade = keyframes({
  '0%': { opacity: 1 },
  '25%': { opacity: 0.55 },
  '50%': { opacity: 0.25 },
  '75%': { opacity: 0.12 },
  '100%': { opacity: 0.08 },
});

const corePulse = keyframes({
  '0%, 100%': { opacity: 0.45 },
  '50%': { opacity: 1 },
});

export const arm = Array.from({ length: ARMS }, (_, i) =>
  style({
    '@layer': {
      recipes: {
        animationName: armFade,
        animationDuration: `${RING_PERIOD_MS}ms`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
        animationDelay: `${-((ARMS - i) % ARMS) * (RING_PERIOD_MS / ARMS)}ms`,
      },
    },
    '@media': {
      '(prefers-reduced-motion: reduce)': {
        animationName: 'none',
        opacity: `${0.08 + (1 - 0.08) * ((ARMS - 1 - i) / (ARMS - 1))}`,
      },
    },
  })
);

export const core = style({
  '@layer': {
    recipes: {
      animationName: corePulse,
      animationDuration: `${CORE_PERIOD_MS}ms`,
      animationTimingFunction: 'ease-in-out',
      animationIterationCount: 'infinite',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationName: 'none',
      opacity: 1,
    },
  },
});

import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import '@styles/layers.css';

// A slow, deliberate breathing pulse — distinct from the working ring's fast
// sweep, so "needs you" reads calmer than "busy" at a glance.
const breathe = keyframes({
  '0%, 100%': { opacity: 0.55, transform: 'scale(0.85)' },
  '50%': { opacity: 1, transform: 'scale(1)' },
});

export const dot = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundWarning,
      stroke: vars.foregroundWarning,
      transformBox: 'fill-box',
      transformOrigin: 'center',
      animationName: breathe,
      animationDuration: '1800ms',
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

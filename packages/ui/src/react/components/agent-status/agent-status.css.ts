import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
// Side-effect import so the @layer order declaration is emitted before these
// rules; otherwise `recipes` gets registered first and loses to app layers.
import '@styles/layers.css';

export const root = style({
  '@layer': {
    recipes: {
      display: 'inline-flex',
      width: 'var(--agent-status-size, 1.5rem)',
      height: 'var(--agent-status-size, 1.5rem)',
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      verticalAlign: 'middle',
    },
  },
});

export const icon = style({
  '@layer': {
    recipes: {
      display: 'block',
      width: '100%',
      height: '100%',
      overflow: 'visible',
    },
  },
});

export const successShape = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundSuccess,
      stroke: vars.foregroundSuccess,
    },
  },
});

export const errorShape = style({
  '@layer': {
    recipes: {
      fill: vars.backgroundError,
      stroke: vars.foregroundError,
    },
  },
});

export const errorMark = style({
  '@layer': {
    recipes: {
      fill: vars.foregroundError,
      stroke: vars.foregroundError,
      strokeLinecap: 'round',
    },
  },
});

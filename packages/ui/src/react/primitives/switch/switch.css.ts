import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';

// Pre-created base so the thumb and hidden-input selectors can reference it.
const switchBase = style({
  display: 'inline-flex',
  position: 'relative',
  flexShrink: 0,
  cursor: 'pointer',
  borderRadius: '9999px',
  border: `1px solid ${vars.border1}`,
  outline: 'none',
  transition: 'background-color 150ms, border-color 150ms',
  backgroundColor: vars.surfaceHover,
  selectors: {
    '&:hover': {
      borderColor: vars.border2,
    },
    '&:focus-visible': {
      borderColor: vars.borderPrimary,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderPrimary} 30%, transparent)`,
    },
    // Ninebrains: the checked track uses the primary-button pair so the thumb (below) can take the
    // matching contrast colour; a monochrome accent would otherwise swallow the thumb.
    '&[data-checked]': {
      backgroundColor: vars.primaryButtonBackground,
      borderColor: vars.primaryButtonBackground,
    },
    '&[data-checked]:hover': {
      backgroundColor: vars.primaryButtonBackgroundHover,
      borderColor: vars.primaryButtonBackgroundHover,
    },
    '&[data-disabled]': {
      pointerEvents: 'none',
      opacity: 0.5,
    },
  },
});

export const switchRoot = recipe({
  base: switchBase,
  variants: {
    size: {
      base: { width: '2rem', height: '1.125rem' },
      sm: { width: '1.5rem', height: '0.875rem' },
    },
  },
  defaultVariants: { size: 'base' },
});

export type SwitchVariants = NonNullable<RecipeVariants<typeof switchRoot>>;

export const switchThumb = style({
  position: 'absolute',
  top: '50%',
  left: '0.125rem',
  transform: 'translateY(-50%)',
  width: '0.75rem',
  height: '0.75rem',
  borderRadius: '9999px',
  backgroundColor: vars.foregroundMuted,
  transition: 'left 150ms, background-color 150ms',
  pointerEvents: 'none',
  selectors: {
    [`${switchBase}[data-checked] &`]: {
      left: 'calc(100% - 0.125rem - 0.75rem)',
      backgroundColor: vars.primaryButtonForeground,
    },
    [`${switchBase}[data-size="sm"] &`]: {
      width: '0.625rem',
      height: '0.625rem',
    },
    [`${switchBase}[data-size="sm"][data-checked] &`]: {
      left: 'calc(100% - 0.125rem - 0.625rem)',
    },
  },
});

// Ensure the hidden input doesn't affect layout
globalStyle(`${switchBase} input[type="checkbox"]`, {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
});

/**
 * WCAG 2.x contrast gate for every registered theme.
 *
 * Values come from the resolved theme (the same cssVars the codegen emits), not copies.
 *  - Body text: AA 4.5:1 against the page backgrounds.
 *  - Status / UI colours: 3:1 against the page background and their own tinted surface.
 *
 * A failing pair must be fixed in the ramp or listed in KNOWN_FAILURES with a reason.
 * Never lower a threshold.
 */

import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { darkTheme } from '../themes/dark.theme';
import { hardstyleTheme } from '../themes/hardstyle.theme';
import { lightTheme } from '../themes/light.theme';
import { THEME_MANIFEST } from '../themes/registry';
import { solarizedDarkTheme } from '../themes/solarized-dark.theme';
import { solarizedLightTheme } from '../themes/solarized-light.theme';
import { nsName } from './contract/namespace';
import type { ResolvedTheme } from './define-theme';

const THEMES: Record<string, ResolvedTheme> = {
  light: lightTheme,
  dark: darkTheme,
  'solarized-light': solarizedLightTheme,
  'solarized-dark': solarizedDarkTheme,
  hardstyle: hardstyleTheme,
};

const BODY_MIN = 4.5;
const STATUS_MIN = 3;

const BODY_FG = ['foreground', 'foreground-body', 'foreground-muted'];
const PAGE_BG = ['background', 'background-1'];
const STATUSES = ['success', 'error', 'warning', 'info'];

/**
 * Pairs that fail today and are accepted for now. Key: `<theme> <fg> on <bg>`.
 * Each needs a reason. Empty means every pair passes.
 */
const KNOWN_FAILURES: Record<string, string> = {};

/** Resolve a semantic var to a Color, evaluating the one color-mix() the template emits. */
function colorOf(theme: ResolvedTheme, name: string): Color {
  const value = theme.cssVars[nsName(name)];
  if (!value) throw new Error(`${theme.id}: missing ${nsName(name)}`);
  const mix = value.match(
    /^color-mix\(in srgb, var\(--em-(\w+)-(\d+)\) (\d+)%, var\(--em-(\w+)-(\d+)\)\)$/
  );
  if (!mix) return new Color(value);
  const step = (scale: string, n: string) =>
    new Color(theme.scales[scale as keyof typeof theme.scales].steps[Number(n) - 1]);
  return Color.mix(step(mix[1], mix[2]), step(mix[4], mix[5]), 1 - Number(mix[3]) / 100, {
    space: 'srgb',
  }) as Color;
}

function ratio(theme: ResolvedTheme, fg: string, bg: string): number {
  return colorOf(theme, bg).contrastWCAG21(colorOf(theme, fg));
}

type Pair = { fg: string; bg: string; min: number };

const PAIRS: Pair[] = [
  ...BODY_FG.flatMap((fg) => PAGE_BG.map((bg) => ({ fg, bg, min: BODY_MIN }))),
  ...STATUSES.flatMap((s) => [
    ...PAGE_BG.map((bg) => ({ fg: `foreground-${s}`, bg, min: STATUS_MIN })),
    { fg: `foreground-${s}`, bg: `background-${s}`, min: STATUS_MIN },
  ]),
];

describe('theme contrast (WCAG)', () => {
  it('covers every registered theme', () => {
    expect(Object.keys(THEMES).sort()).toEqual(THEME_MANIFEST.map((t) => t.id).sort());
  });

  for (const entry of THEME_MANIFEST) {
    const theme = THEMES[entry.id];
    describe(entry.id, () => {
      for (const { fg, bg, min } of PAIRS) {
        const key = `${entry.id} ${fg} on ${bg}`;
        it(`${fg} on ${bg} >= ${min}:1`, () => {
          const r = ratio(theme, fg, bg);
          if (key in KNOWN_FAILURES) {
            expect(r, `allowlisted pair now passes, remove it: ${key}`).toBeLessThan(min);
            return;
          }
          expect(r, `${key} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

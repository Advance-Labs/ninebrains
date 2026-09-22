import * as React from 'react';
import * as styles from './working-mark-icon.css';

/**
 * The nine cells of the Ninebrains mark, in the 70x70 glyph box centred on
 * (35, 35). Geometry is shared with `tooling/brand/glyph.mjs`
 * and `emdash-logo.tsx`; change all three together.
 */
const CENTRE = 35;
const GAP = 21;
const ARM = 13;
const CORE = 20;
const RADIUS = 2;

/** Clockwise from the top, so the ring's animation delay traces a lap. */
const ARM_CELLS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

/**
 * WorkingMarkIcon — the brand mark (nine squares, one central brain plus eight
 * arm brains) standing in for the generic "agent is working" animation.
 *
 * Flat fills only, no gradient or grain: the eight arm squares take turns
 * lighting up around the ring while the core pulses on its own faster cycle,
 * the same calm sweep-not-spin motion as `SegmentedSpinnerIcon`.
 */
function WorkingMarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 70 70" fill="currentColor" aria-hidden="true" {...props}>
      {ARM_CELLS.map(({ dx, dy }, index) => (
        <rect
          key={`${dx},${dy}`}
          x={CENTRE + dx * GAP - ARM / 2}
          y={CENTRE + dy * GAP - ARM / 2}
          width={ARM}
          height={ARM}
          rx={RADIUS}
          className={styles.arm[index]}
        />
      ))}
      <rect
        x={CENTRE - CORE / 2}
        y={CENTRE - CORE / 2}
        width={CORE}
        height={CORE}
        rx={RADIUS}
        className={styles.core}
      />
    </svg>
  );
}

export { WorkingMarkIcon };

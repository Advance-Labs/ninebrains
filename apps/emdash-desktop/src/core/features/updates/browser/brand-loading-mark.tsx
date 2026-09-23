import type { JSX } from 'react';
import './brand-loading-mark.css';

const ARMS: ReadonlyArray<readonly [number, number]> = [
  [28.5, 7.5],
  [49.5, 7.5],
  [49.5, 28.5],
  [49.5, 49.5],
  [28.5, 49.5],
  [7.5, 49.5],
  [7.5, 28.5],
  [7.5, 7.5],
];

/**
 * The Ninebrains nine-square mark with the boot-splash lap animation, sized for inline use (the
 * update pill, working states). Shares geometry with the boot splash and tooling/brand/glyph.mjs.
 */
export function BrandLoadingMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={`brand-loading-mark${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      viewBox="0 0 70 70"
      aria-hidden="true"
      focusable="false"
    >
      {ARMS.map(([x, y], index) => (
        <rect
          key={index}
          style={{ animationDelay: `calc(1.2s + ${index} * 0.2s)` }}
          x={x}
          y={y}
          width="13"
          height="13"
          rx="2"
        />
      ))}
      <rect className="brand-loading-mark-core" x="25" y="25" width="20" height="20" rx="2" />
    </svg>
  );
}

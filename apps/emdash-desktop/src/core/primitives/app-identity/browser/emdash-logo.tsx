export const NATURAL_WIDTH = 350;
export const NATURAL_HEIGHT = 70;

/**
 * The nine cells of the mark, in the 70x70 glyph box centred on (35, 35). The geometry is shared
 * with `tooling/brand/glyph.mjs`, which renders the same grid into the icons, favicon and docs
 * assets; change both together.
 */
const GAP = 21;
const ARM = 13;
const CORE = 20;
const RADIUS = 2;

const ARM_CELLS = [-1, 0, 1]
  .flatMap((dx) => [-1, 0, 1].map((dy) => ({ dx, dy })))
  .filter(({ dx, dy }) => dx !== 0 || dy !== 0);

/**
 * The Ninebrains logo: the mark (a 3x3 grid of nine squares, the central one larger: one central
 * brain plus eight arm brains) followed by the wordmark, in a 350x70 box. Every shape is a fill,
 * so the root <svg> paints with `fill`; the group turns stroke off because the root sets it too.
 */
export function LogoShapes() {
  return (
    <g strokeWidth={0}>
      {ARM_CELLS.map(({ dx, dy }) => (
        <rect
          key={`${dx},${dy}`}
          x={35 + dx * GAP - ARM / 2}
          y={35 + dy * GAP - ARM / 2}
          width={ARM}
          height={ARM}
          rx={RADIUS}
        />
      ))}
      <rect x={35 - CORE / 2} y={35 - CORE / 2} width={CORE} height={CORE} rx={RADIUS} />
      <text
        x={82}
        y={51}
        fontSize={46}
        fontWeight={600}
        letterSpacing={-1}
        fontFamily="'Inter Variable', Inter, system-ui, sans-serif"
      >
        ninebrains
      </text>
    </g>
  );
}

export function EmdashLogo({
  className,
  height = NATURAL_HEIGHT,
  color = 'currentColor',
}: {
  className?: string;
  height?: number;
  color?: string;
}) {
  const width = (height / NATURAL_HEIGHT) * NATURAL_WIDTH;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${NATURAL_WIDTH} ${NATURAL_HEIGHT}`}
      fill={color}
      stroke={color}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <LogoShapes />
    </svg>
  );
}

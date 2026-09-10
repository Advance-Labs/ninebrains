export const NATURAL_WIDTH = 350;
export const NATURAL_HEIGHT = 70;

const ARM_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The Ninebrains logo: the mark (one central brain, eight arms each ending in a small brain)
 * followed by the wordmark, in a 350x70 box. The arms are strokes, so the root <svg> must set
 * both `fill` and `stroke` to the logo paint; the filled shapes turn their stroke off.
 */
export function LogoShapes() {
  return (
    <>
      <g fill="none" strokeWidth={3} strokeLinecap="round">
        {ARM_ANGLES.map((angle) => (
          <path
            key={angle}
            transform={`rotate(${angle} 35 35)`}
            d="M 35 25 C 41.2 17.5, 29.2 11.5, 36.4 5"
          />
        ))}
      </g>
      <g strokeWidth={0}>
        {ARM_ANGLES.map((angle) => (
          <circle key={angle} transform={`rotate(${angle} 35 35)`} cx={36.4} cy={5} r={3.4} />
        ))}
        <circle cx={35} cy={35} r={11.8} />
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
    </>
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

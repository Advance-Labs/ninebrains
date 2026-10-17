import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Every animation in the TUI goes through here, so one switch turns them all off. Codex calls
 * the same split `MotionMode`. The maths is pure and takes elapsed milliseconds, so it is tested
 * without a clock or a terminal.
 *
 * Off when NINEBRAINS_REDUCED_MOTION is set (any value but "0"), or when stdout is not a TTY.
 */
export function animationsEnabled(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  const reduced = env.NINEBRAINS_REDUCED_MOTION;
  return Boolean(isTTY) && (reduced === undefined || reduced === '0');
}

export const MotionContext = createContext<boolean>(
  animationsEnabled(process.env, process.stdout.isTTY)
);

export function useAnimations(): boolean {
  return useContext(MotionContext);
}

/** Ink caps its own redraws near 30 fps; 10 fps is enough for terminal motion and cheap. */
export const FRAME_MS = 100;

/**
 * The current time, re-rendering every frame while `active`. When animations are off, or
 * nothing is moving, no timer runs, so an idle Brain leaves the screen (and the CPU) still.
 */
export function useNow(active: boolean): number {
  const animate = useAnimations() && active;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setNow(Date.now()), FRAME_MS);
    return () => clearInterval(timer);
  }, [animate]);
  return animate ? now : Date.now();
}

/** Codex's and opencode's spinner. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const STATIC_SPINNER = '◌';

export function spinnerFrame(elapsedMs: number): string {
  return SPINNER_FRAMES[Math.floor(Math.max(elapsedMs, 0) / FRAME_MS) % SPINNER_FRAMES.length]!;
}

const SHIMMER_SWEEP_MS = 2_000;
const SHIMMER_PADDING = 10;
const SHIMMER_HALF_WIDTH = 5;

/**
 * Codex's shimmer: a band about 10 characters wide sweeps across the text every two seconds.
 * Returns each character's brightness, 0 to 1, with a cosine falloff from the band's centre.
 */
export function shimmerLevels(length: number, elapsedMs: number): number[] {
  const period = length + SHIMMER_PADDING * 2;
  const centre = ((elapsedMs % SHIMMER_SWEEP_MS) / SHIMMER_SWEEP_MS) * period;
  return Array.from({ length }, (_, i) => {
    const distance = Math.abs(i + SHIMMER_PADDING - centre);
    return distance > SHIMMER_HALF_WIDTH
      ? 0
      : 0.5 * (1 + Math.cos((Math.PI * distance) / SHIMMER_HALF_WIDTH));
  });
}

/** opencode's fade-in: a new line arrives dim and settles. */
export const FADE_MS = 300;
/** opencode's completion flash: a finished job glows, then settles. */
export const FLASH_MS = 1_200;

/** How long any feed line keeps animating, so the feed can stop ticking after that. */
export const SETTLE_MS = Math.max(FADE_MS, FLASH_MS);

/** The dispatcher dot breathes while jobs run: bright and dim, 600 ms each. */
export function pulseOn(elapsedMs: number): boolean {
  return Math.floor(elapsedMs / 600) % 2 === 0;
}

/** 0s, 59s, 1m 00s, 1h 02m 03s: Codex's `fmt_elapsed_compact`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

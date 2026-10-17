import { Box, Text } from 'ink';
import React from 'react';
import { isActive } from '../feed';
import {
  formatElapsed,
  shimmerLevels,
  spinnerFrame,
  STATIC_SPINNER,
  useAnimations,
  useNow,
} from '../motion';
import { useBrainStore } from '../store';

/** Shimmer as text styles: theme-safe (no fixed RGB), so it reads on dark and light terminals. */
function Shimmer({ text, elapsedMs }: { text: string; elapsedMs: number }) {
  const levels = shimmerLevels(text.length, elapsedMs);
  return (
    <Text>
      {Array.from(text).map((char, i) => {
        const level = levels[i] ?? 0;
        return (
          <Text key={i} color="cyan" dimColor={level < 0.2} bold={level >= 0.6}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * Codex's live status row, above the prompt while any lane holds a job: a spinner, a shimmering
 * "Working", what is running, and how long the Brain has been busy. Absent when nothing runs.
 */
export function WorkingRow() {
  const { jobs, busySince } = useBrainStore();
  const animate = useAnimations();
  const now = useNow(busySince !== null);
  if (busySince === null) return null;

  const active = jobs.filter(isActive);
  const what = active.length === 1 ? active[0]!.title : `${active.length} active`;
  const elapsed = now - busySince;

  return (
    <Box paddingX={2}>
      <Text wrap="truncate-end">
        <Text color="cyan">{animate ? spinnerFrame(elapsed) : STATIC_SPINNER} </Text>
        {animate ? (
          <Shimmer text="Working" elapsedMs={elapsed} />
        ) : (
          <Text color="cyan">Working</Text>
        )}
        <Text dimColor>
          {' · '}
          {what} · {formatElapsed(elapsed)}
        </Text>
      </Text>
    </Box>
  );
}

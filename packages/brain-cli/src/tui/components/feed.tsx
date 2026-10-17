import { Box, Text } from 'ink';
import React from 'react';
import { TONE_GLYPH, type FeedEvent, type FeedTone } from '../feed';
import { FADE_MS, FLASH_MS, SETTLE_MS, useAnimations, useNow } from '../motion';
import { useBrainStore } from '../store';

const TONE_COLOR: Record<FeedTone, string> = {
  ok: 'green',
  go: 'blue',
  warn: 'yellow',
  fail: 'red',
  info: 'gray',
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * opencode's motion, as text styles: a new line arrives dim and settles (fade-in), and a job that
 * finished glows green, then settles (completion flash).
 */
function FeedLine({ event, ageMs }: { event: FeedEvent; ageMs: number | null }) {
  const fading = ageMs !== null && ageMs < FADE_MS;
  const flashing =
    ageMs !== null && ageMs < FLASH_MS && event.tone === 'ok' && event.kind === 'job';
  return (
    <Box paddingX={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" dimColor={fading}>
          <Text color={TONE_COLOR[event.tone]}>{TONE_GLYPH[event.tone]} </Text>
          <Text dimColor>{event.kind.padEnd(5)} </Text>
          <Text color={flashing ? 'green' : undefined} bold={flashing}>
            {event.text}
          </Text>
        </Text>
      </Box>
      <Text dimColor> {time(event.at)}</Text>
    </Box>
  );
}

/** The transcript: newest at the bottom, as many lines as fit. */
export function Feed({ rows }: { rows: number }) {
  const { feed } = useBrainStore();
  const animate = useAnimations();
  const newest = feed[feed.length - 1];
  // Tick only while the newest line is still settling; an idle feed renders once and stops.
  const now = useNow(newest !== undefined && Date.now() - newest.at < SETTLE_MS);
  const visible = feed.slice(-Math.max(rows, 1));
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
      {visible.length === 0 ? (
        <Text dimColor> Connecting to the Brain…</Text>
      ) : (
        visible.map((event) => (
          <FeedLine key={event.id} event={event} ageMs={animate ? now - event.at : null} />
        ))
      )}
    </Box>
  );
}

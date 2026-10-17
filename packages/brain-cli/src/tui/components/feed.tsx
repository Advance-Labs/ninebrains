import { Box, Text } from 'ink';
import React from 'react';
import { TONE_GLYPH, type FeedEvent, type FeedTone } from '../feed';
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

function FeedLine({ event }: { event: FeedEvent }) {
  return (
    <Box paddingX={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={TONE_COLOR[event.tone]}>{TONE_GLYPH[event.tone]} </Text>
          <Text dimColor>{event.kind.padEnd(5)} </Text>
          <Text>{event.text}</Text>
        </Text>
      </Box>
      <Text dimColor> {time(event.at)}</Text>
    </Box>
  );
}

/** The transcript: newest at the bottom, as many lines as fit. */
export function Feed({ rows }: { rows: number }) {
  const { feed } = useBrainStore();
  const visible = feed.slice(-Math.max(rows, 1));
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
      {visible.length === 0 ? (
        <Text dimColor> Connecting to the Brain…</Text>
      ) : (
        visible.map((event) => <FeedLine key={event.id} event={event} />)
      )}
    </Box>
  );
}

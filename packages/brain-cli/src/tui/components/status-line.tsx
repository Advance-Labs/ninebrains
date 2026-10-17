import { Box, Text } from 'ink';
import React from 'react';
import { isActive } from '../feed';
import { useBrainStore } from '../store';

const count = (
  items: readonly { state?: string; status?: string }[],
  key: 'state' | 'status',
  value: string
) => items.filter((item) => item[key] === value).length;

/** One dim line under the prompt. Truncated, never wrapped. A hold-up reason wins the right side. */
export function StatusLine() {
  const { jobs, lanes, hint } = useBrainStore();
  const active = jobs.filter(isActive).length;
  const jobPart = `${count(jobs, 'state', 'ready')} ready · ${active} active · ${count(jobs, 'state', 'blocked')} blocked`;
  const idle = count(lanes, 'status', 'idle');
  const asleep = count(lanes, 'status', 'asleep');
  const lanePart = `lanes ${lanes.length - asleep} live${asleep ? ` · ${asleep} asleep` : ''} · ${idle} idle`;

  return (
    <Box paddingX={2}>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {jobPart} {'  '}
          {lanePart}
        </Text>
      </Box>
      {hint && (
        <Box flexShrink={2}>
          <Text color="yellow" wrap="truncate-end">
            {' '}
            ⚠ {hint}
          </Text>
        </Box>
      )}
    </Box>
  );
}

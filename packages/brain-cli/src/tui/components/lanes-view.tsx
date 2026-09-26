import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS, laneStatusColor, SYMBOLS } from '../theme';

export function LanesView() {
  const { lanes, setLaneMode, jobs } = useBrainStore();
  const [cursor, setCursor] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useInput((input, key) => {
    setActionError(null);
    setActionSuccess(null);

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(lanes.length - 1, c + 1));
      return;
    }

    const lane = lanes[cursor];
    if (!lane) return;

    if (input === 'm') {
      const newMode =
        lane.status === 'idle' || lane.status === 'asleep' ? 'unattended' : 'attended';
      void (async () => {
        const res = await setLaneMode(lane.id, newMode);
        if (!res.ok) setActionError(res.error.message);
        else setActionSuccess(`Set ${lane.id} to ${newMode}`);
      })();
      return;
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Lanes
        </Text>
        <Text color={COLORS.secondary}> — {lanes.length} total</Text>
      </Box>

      {actionError && <Text color={COLORS.danger}>{actionError}</Text>}
      {actionSuccess && <Text color={COLORS.success}>{actionSuccess}</Text>}

      <Box flexDirection="column">
        <Box borderStyle="single" borderBottom paddingX={1}>
          <Text bold>
            {'ID'.padEnd(16)} {'Provider'.padEnd(10)} {'Status'.padEnd(12)} {'Mode'.padEnd(12)}{' '}
            {'Active Job'}
          </Text>
        </Box>
        {lanes.length === 0 && <Text color={COLORS.secondary}>No lanes active.</Text>}
        {lanes.map((lane, index) => {
          const laneJobs = jobs.filter((j) => j.laneId === lane.id);
          const isSelected = index === cursor;
          return (
            <Box key={lane.id}>
              <Text>{isSelected ? '> ' : '  '}</Text>
              <Box width={16}>
                <Text color={COLORS.text}>{lane.id.slice(0, 15)}</Text>
              </Box>
              <Box width={10}>
                <Text color={COLORS.secondary}>{lane.provider}</Text>
              </Box>
              <Box width={12}>
                <Text color={laneStatusColor(lane.status)}>
                  {SYMBOLS.bullet} {lane.status}
                </Text>
              </Box>
              <Box width={12}>
                <Text>
                  {lane.status === 'idle' || lane.status === 'asleep' ? 'attended' : 'unattended'}
                </Text>
              </Box>
              <Text color={COLORS.secondary}>{lane.activeJobId ?? `${laneJobs.length} jobs`}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.secondary}>[m] Toggle mode for selected lane</Text>
      </Box>
    </Box>
  );
}

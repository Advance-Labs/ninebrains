import { Box, Text } from 'ink';
import React from 'react';
import { useBrainStore } from '../store';
import { COLORS, laneStatusColor, stateColor, SYMBOLS } from '../theme';

export function Dashboard() {
  const { jobs, lanes, dispatcherStatus, notes } = useBrainStore();

  const recentJobs = jobs.slice(0, 8);
  const readyCount = jobs.filter((j) => j.state === 'ready').length;
  const runningCount = jobs.filter((j) => j.state === 'running').length;
  const blockedCount = jobs.filter((j) => j.state === 'blocked').length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Dashboard
        </Text>
        <Text color={COLORS.secondary}> — press a number key to navigate views</Text>
      </Box>

      <Box>
        {/* Jobs panel */}
        <Box flexDirection="column" width="50%" paddingRight={1}>
          <Box borderStyle="single" borderBottom flexDirection="column" paddingX={1}>
            <Text bold>
              Jobs ({jobs.length}) — {SYMBOLS.ready}
              <Text color={COLORS.success}> {readyCount} ready</Text> {SYMBOLS.running}
              <Text color={COLORS.info}> {runningCount} running</Text> {SYMBOLS.blocked}
              <Text color={COLORS.danger}> {blockedCount} blocked</Text>
            </Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            {recentJobs.length === 0 && (
              <Text color={COLORS.secondary}>No jobs yet. Press n to create one.</Text>
            )}
            {recentJobs.map((job) => (
              <Box key={job.id}>
                <Text color={stateColor(job.state)}>{SYMBOLS.bullet} </Text>
                <Text color={COLORS.text} dimColor={job.state === 'done'}>
                  {job.title}
                </Text>
                <Text color={COLORS.secondary}> {job.state}</Text>
                {job.laneId && <Text color={COLORS.secondary}> @{job.laneId}</Text>}
              </Box>
            ))}
            {jobs.length > 8 && (
              <Text color={COLORS.secondary}>...and {jobs.length - 8} more (press 2)</Text>
            )}
          </Box>
        </Box>

        {/* Lanes + Status panel */}
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          <Box borderStyle="single" borderBottom flexDirection="column" paddingX={1}>
            <Text bold>Lanes ({lanes.length})</Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            {lanes.length === 0 && <Text color={COLORS.secondary}>No lanes active.</Text>}
            {lanes.map((lane) => (
              <Box key={lane.id}>
                <Text color={laneStatusColor(lane.status)}>{SYMBOLS.bullet} </Text>
                <Text color={COLORS.text}>{lane.id}</Text>
                <Text color={COLORS.secondary}> {lane.provider}</Text>
                <Text color={laneStatusColor(lane.status)}> {lane.status}</Text>
                {lane.activeJobId && <Text color={COLORS.secondary}> → {lane.activeJobId}</Text>}
              </Box>
            ))}
          </Box>

          {dispatcherStatus && (
            <Box marginTop={1} flexDirection="column">
              <Box borderStyle="single" borderBottom paddingX={1}>
                <Text bold>Dispatcher</Text>
              </Box>
              <Box paddingX={1} flexDirection="column">
                <Text>
                  Status:{' '}
                  {dispatcherStatus.stopLatched ? (
                    <Text bold color={COLORS.danger}>
                      STOPPED
                    </Text>
                  ) : dispatcherStatus.paused ? (
                    <Text color={COLORS.warning}>Paused</Text>
                  ) : (
                    <Text color={COLORS.success}>Dispatching</Text>
                  )}
                </Text>
                <Text>Active runs: {dispatcherStatus.activeRuns}</Text>
                <Text>Gates connected: {dispatcherStatus.gatesConnected ? 'yes' : 'no'}</Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Recent notes */}
      {notes.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="single" borderBottom paddingX={1}>
            <Text bold>Recent Notes</Text>
          </Box>
          <Box paddingX={1} flexDirection="column">
            {notes.slice(0, 3).map((note) => (
              <Box key={note.id}>
                <Text color={COLORS.secondary}>• </Text>
                <Text color={COLORS.text}>{note.body.slice(0, 80)}</Text>
                {note.body.length > 80 && <Text color={COLORS.secondary}>...</Text>}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

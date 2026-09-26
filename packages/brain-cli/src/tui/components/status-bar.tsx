import { Box, Text } from 'ink';
import React from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

export function StatusBar() {
  const { error, dispatcherStatus, jobs, lanes, lastRefresh, view } = useBrainStore();

  const isForm = view === 'create-job' || view === 'send-message';

  return (
    <Box paddingX={1} paddingY={0} borderStyle="single" borderTop flexDirection="column">
      {error && <Text color={COLORS.danger}>Error: {error}</Text>}
      <Box>
        <Box flexGrow={1}>
          {!isForm && (
            <>
              <Text color={COLORS.secondary}>
                [1]Dashboard [2]Jobs [3]Lanes [4]Notes [5]Messages
              </Text>
              <Text color={COLORS.secondary}> | </Text>
              <Text color={COLORS.secondary}>[n]New [s]Send [r]Refresh [?]Help [q]Quit</Text>
            </>
          )}
          {isForm && (
            <Text color={COLORS.secondary}>[Tab]Next field [Enter]Submit [Esc]Cancel</Text>
          )}
        </Box>
        <Box>
          {dispatcherStatus && (
            <Text color={COLORS.secondary}>
              {dispatcherStatus.stopLatched ? (
                <Text color={COLORS.danger}>STOP </Text>
              ) : dispatcherStatus.paused ? (
                <Text color={COLORS.warning}>Paused </Text>
              ) : (
                <Text color={COLORS.success}>Dispatching </Text>
              )}
              | {jobs.length} jobs | {lanes.length} lanes
              {lastRefresh > 0 && (
                <Text color={COLORS.muted}>
                  {' '}
                  (refreshed {new Date(lastRefresh).toLocaleTimeString()})
                </Text>
              )}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

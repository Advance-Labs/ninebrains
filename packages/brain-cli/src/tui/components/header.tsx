import { Box, Text } from 'ink';
import React from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

export function Header() {
  const { view, loading, projectId } = useBrainStore();

  const viewLabel: Record<string, string> = {
    dashboard: 'Dashboard',
    jobs: 'Jobs',
    lanes: 'Lanes',
    notes: 'Notes',
    messages: 'Messages',
    'create-job': 'New Job',
    'send-message': 'Send Message',
  };

  return (
    <Box paddingX={1} paddingY={0} borderStyle="single" borderBottom>
      <Box flexGrow={1}>
        <Text bold color={COLORS.primary}>
          Ninebrains Brain
        </Text>
        <Text color={COLORS.secondary}> — {viewLabel[view] ?? view}</Text>
        {projectId && <Text color={COLORS.secondary}> | project: {projectId}</Text>}
      </Box>
      <Box>{loading && <Text color={COLORS.warning}> refreshing...</Text>}</Box>
    </Box>
  );
}

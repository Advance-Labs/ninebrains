import { Box, Text } from 'ink';
import React from 'react';
import { COLORS } from '../theme';

export function HelpOverlay() {
  const shortcuts = [
    ['1', 'Dashboard — overview of jobs, lanes, and status'],
    ['2', 'Jobs — list and manage all jobs'],
    ['3', 'Lanes — view lanes and toggle modes'],
    ['4', 'Notes — project notes and job notes'],
    ['5', 'Messages — read inbox and send messages'],
    ['n', 'New Job — create a new job'],
    ['s', 'Send Message — send a message to a lane or brain'],
    ['r', 'Refresh — reload all data'],
    ['?', 'Toggle this help overlay'],
    ['q', 'Quit the TUI'],
    ['Esc', 'Go back / close form'],
  ];

  const jobShortcuts = [
    ['↑ / ↓', 'Navigate jobs list'],
    ['Enter', 'Select job for details'],
    ['b', 'Block selected job'],
    ['c', 'Complete selected job'],
    ['a', 'Assign selected job to lane'],
    ['R', 'Requeue selected job'],
  ];

  return (
    <Box
      borderStyle="round"
      borderColor={COLORS.primary}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color={COLORS.primary}>
        Keyboard Shortcuts
      </Text>
      <Box marginTop={1} flexDirection="column">
        {shortcuts.map(([key, desc]) => (
          <Box key={key}>
            <Box width={12}>
              <Text bold color={COLORS.warning}>
                {key}
              </Text>
            </Box>
            <Text color={COLORS.text}>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text bold color={COLORS.primary}>
          In Jobs View:
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {jobShortcuts.map(([key, desc]) => (
          <Box key={key}>
            <Box width={12}>
              <Text bold color={COLORS.warning}>
                {key}
              </Text>
            </Box>
            <Text color={COLORS.text}>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.secondary}>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
}

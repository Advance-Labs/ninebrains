import { Box, Text } from 'ink';
import React from 'react';
import { useBrainStore } from '../store';

/** A readable id as is; a UUID cut to its first block, since the Brain has no project names. */
const projectLabel = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? `project ${id.slice(0, 8)}` : id;

/** One line, no border: the project, then the dispatcher's state as a coloured dot. */
export function Header({ width }: { width: number }) {
  const { projectId, dispatcherStatus, connected } = useBrainStore();
  const [label, color] = !connected
    ? ['connecting', 'gray']
    : dispatcherStatus?.stopLatched
      ? ['STOP latched', 'red']
      : dispatcherStatus?.paused
        ? ['paused', 'yellow']
        : ['dispatching', 'green'];

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" paddingX={1}>
        <Text wrap="truncate-end">
          <Text bold color="cyan">
            Ninebrains Brain
          </Text>
          <Text dimColor> · {projectId ? projectLabel(projectId) : 'all projects'}</Text>
        </Text>
        <Text color={color}>● {label}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(width)}</Text>
    </Box>
  );
}

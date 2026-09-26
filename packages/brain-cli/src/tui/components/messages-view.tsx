import { Box, Text, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

export function MessagesView() {
  const { messages, readInbox, setView } = useBrainStore();
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    void readInbox(50);
  }, [readInbox]);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(messages.length - 1, c + 1));
      return;
    }
    if (input === 's') {
      setView('send-message');
      return;
    }
    if (input === 'r') {
      void readInbox(50);
      return;
    }
  });

  const sortedMessages = [...messages].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Messages
        </Text>
        <Text color={COLORS.secondary}> — {messages.length} in inbox</Text>
      </Box>

      <Box flexDirection="column">
        {sortedMessages.length === 0 && (
          <Text color={COLORS.secondary}>No messages. Press s to send one.</Text>
        )}
        {sortedMessages.map((msg, index) => {
          const isSelected = index === cursor;
          const date = new Date(msg.createdAt).toLocaleString();
          const fromStr = `${msg.from.kind}:${msg.from.id}`;
          const toStr = `${msg.to.kind}:${msg.to.id}`;
          return (
            <Box key={msg.id} flexDirection="column">
              <Box>
                <Text>{isSelected ? '> ' : '  '}</Text>
                <Text color={COLORS.secondary}>[{date}] </Text>
                <Text color={COLORS.info}>{fromStr}</Text>
                <Text color={COLORS.secondary}> → </Text>
                <Text color={COLORS.info}>{toStr}</Text>
                {msg.untrusted && <Text color={COLORS.warning}> (untrusted)</Text>}
              </Box>
              <Box paddingLeft={4}>
                <Text color={COLORS.text}>{msg.body.slice(0, 120)}</Text>
                {msg.body.length > 120 && <Text color={COLORS.secondary}>...</Text>}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.secondary}>[s] Send message [r] Refresh [↑↓] Navigate</Text>
      </Box>
    </Box>
  );
}

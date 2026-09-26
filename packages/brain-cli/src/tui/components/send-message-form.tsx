import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

type FormField = 'to' | 'body';

export function SendMessageForm() {
  const { sendMessage, lanes, goBack } = useBrainStore();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [field, setField] = useState<FormField>('to');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const laneOptions = lanes.map((l) => l.id);

  useInput((input, key) => {
    if (success) {
      if (input === 's') {
        setTo('');
        setBody('');
        setField('to');
        setSuccess(false);
        setError(null);
      } else if (key.escape || input === 'q') {
        goBack();
      }
      return;
    }

    if (key.escape) {
      goBack();
      return;
    }

    if (key.tab) {
      setField((f) => (f === 'to' ? 'body' : 'to'));
      return;
    }

    if (key.return) {
      if (field === 'body') {
        void submit();
      } else {
        setField('body');
      }
      return;
    }

    if (key.backspace || key.delete) {
      updateField((v) => v.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      updateField((v) => v + input);
      return;
    }
  });

  function updateField(updater: (v: string) => string) {
    switch (field) {
      case 'to':
        setTo(updater);
        break;
      case 'body':
        setBody(updater);
        break;
    }
  }

  async function submit() {
    if (!to.trim() || !body.trim()) {
      setError('To and body are required');
      return;
    }
    const toTrimmed = to.trim();
    // Determine if it's a lane or brain address
    const kind: 'lane' | 'brain' = laneOptions.includes(toTrimmed) ? 'lane' : 'brain';
    const res = await sendMessage({ kind, id: toTrimmed }, body.trim());
    if (!res.ok) {
      setError(res.error.message);
    } else {
      setSuccess(true);
      setError(null);
    }
  }

  if (success) {
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Text bold color={COLORS.success}>
          Message sent!
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.secondary}>[s] Send another [Esc/q] Back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Send Message
        </Text>
      </Box>

      {error && <Text color={COLORS.danger}>{error}</Text>}

      <Box flexDirection="column">
        <Box>
          <Text bold color={field === 'to' ? COLORS.primary : COLORS.secondary}>
            To{field === 'to' ? ' >' : ''}
          </Text>
        </Box>
        <Text color={COLORS.secondary}>
          Lane IDs: {laneOptions.join(', ') || 'none'} — or brain:&lt;id&gt;
        </Text>
        <Box borderStyle={field === 'to' ? 'single' : undefined} paddingX={1}>
          <Text color={COLORS.text}>{to || ' '}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold color={field === 'body' ? COLORS.primary : COLORS.secondary}>
            Body{field === 'body' ? ' >' : ''}
          </Text>
        </Box>
        <Box borderStyle={field === 'body' ? 'single' : undefined} paddingX={1}>
          <Text color={COLORS.text}>{body || ' '}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.secondary}>
          [Tab] Next field [Enter] Submit field / Send [Esc] Cancel
        </Text>
      </Box>
    </Box>
  );
}

import { LIMITS, utf8Bytes } from '@ninebrains/brain-core';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

type FormField = 'title' | 'body' | 'gates';

export function CreateJobForm() {
  const { createJob, goBack } = useBrainStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [gates, setGates] = useState('');
  const [field, setField] = useState<FormField>('title');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useInput((input, key) => {
    if (success) {
      if (input === 'n') {
        setTitle('');
        setBody('');
        setGates('');
        setField('title');
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
      const fields: FormField[] = ['title', 'body', 'gates'];
      const next = fields[(fields.indexOf(field) + 1) % fields.length];
      setField(next);
      return;
    }

    if (key.return) {
      if (field === 'gates') {
        void submit();
      } else {
        const fields: FormField[] = ['title', 'body', 'gates'];
        const next = fields[(fields.indexOf(field) + 1) % fields.length];
        setField(next);
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
      case 'title':
        setTitle(updater);
        break;
      case 'body':
        setBody(updater);
        break;
      case 'gates':
        setGates(updater);
        break;
    }
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    if (trimmedTitle.length > LIMITS.titleChars) {
      setError(`Title must be at most ${LIMITS.titleChars} characters`);
      return;
    }
    const trimmedBody = body.trim();
    if (trimmedBody && utf8Bytes(trimmedBody) > LIMITS.bodyBytes) {
      setError(`Body must be at most ${LIMITS.bodyBytes} bytes`);
      return;
    }
    const gateList = gates
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    const res = await createJob({
      title: trimmedTitle,
      body: trimmedBody || undefined,
      gates: gateList.length > 0 ? gateList : undefined,
    });
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
          Job created successfully!
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.secondary}>[n] Create another [Esc/q] Back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Create New Job
        </Text>
      </Box>

      {error && <Text color={COLORS.danger}>{error}</Text>}

      <Box flexDirection="column">
        <Box>
          <Text bold color={field === 'title' ? COLORS.primary : COLORS.secondary}>
            Title{field === 'title' ? ' >' : ''}
          </Text>
          <Text color={title.length > LIMITS.titleChars ? COLORS.danger : COLORS.secondary}>
            {' '}
            ({title.length}/{LIMITS.titleChars})
          </Text>
        </Box>
        <Box borderStyle={field === 'title' ? 'single' : undefined} paddingX={1}>
          <Text color={COLORS.text}>{title || ' '}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold color={field === 'body' ? COLORS.primary : COLORS.secondary}>
            Body{field === 'body' ? ' >' : ''}
          </Text>
          <Text color={utf8Bytes(body) > LIMITS.bodyBytes ? COLORS.danger : COLORS.secondary}>
            {' '}
            ({utf8Bytes(body)} bytes/{LIMITS.bodyBytes})
          </Text>
        </Box>
        <Box borderStyle={field === 'body' ? 'single' : undefined} paddingX={1}>
          <Text color={COLORS.text}>{body || ' '}</Text>
        </Box>

        <Box marginTop={1}>
          <Text bold color={field === 'gates' ? COLORS.primary : COLORS.secondary}>
            Gates (comma-separated){field === 'gates' ? ' >' : ''}
          </Text>
        </Box>
        <Box borderStyle={field === 'gates' ? 'single' : undefined} paddingX={1}>
          <Text color={COLORS.text}>{gates || ' '}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.secondary}>
          [Tab] Next field [Enter] Submit field / Create [Esc] Cancel
        </Text>
      </Box>
    </Box>
  );
}

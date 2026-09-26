import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS } from '../theme';

export function NotesView() {
  const { notes, addNote, jobs } = useBrainStore();
  const [cursor, setCursor] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [newNoteBody, setNewNoteBody] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedNotes = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  useInput((input, key) => {
    if (showForm) {
      if (key.return) {
        void (async () => {
          const res = await addNote(newNoteBody);
          if (!res.ok) setActionError(res.error.message);
          else {
            setNewNoteBody('');
            setShowForm(false);
            setActionError(null);
          }
        })();
        return;
      }
      if (key.escape) {
        setShowForm(false);
        setNewNoteBody('');
        return;
      }
      if (key.backspace || key.delete) {
        setNewNoteBody((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setNewNoteBody((b) => b + input);
        return;
      }
      return;
    }

    setActionError(null);

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(sortedNotes.length - 1, c + 1));
      return;
    }
    if (input === 'n') {
      setShowForm(true);
      return;
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Notes
        </Text>
        <Text color={COLORS.secondary}> — {notes.length} total</Text>
      </Box>

      {actionError && <Text color={COLORS.danger}>{actionError}</Text>}

      {showForm && (
        <Box borderStyle="single" borderColor={COLORS.primary} paddingX={1} flexDirection="column">
          <Text bold>New Note</Text>
          <Text color={COLORS.secondary}>{newNoteBody || '(type note...)'}</Text>
          <Text color={COLORS.secondary}>[Enter] Save [Esc] Cancel</Text>
        </Box>
      )}

      {!showForm && (
        <Box flexDirection="column">
          {sortedNotes.length === 0 && (
            <Text color={COLORS.secondary}>No notes. Press n to add one.</Text>
          )}
          {sortedNotes.map((note, index) => {
            const isSelected = index === cursor;
            const date = new Date(note.createdAt).toLocaleDateString();
            const linkedJob = note.jobId ? jobs.find((j) => j.id === note.jobId) : null;
            return (
              <Box key={note.id}>
                <Text>{isSelected ? '> ' : '  '}</Text>
                <Text color={COLORS.secondary}>[{date}] </Text>
                <Text color={COLORS.text}>{note.body.slice(0, 100)}</Text>
                {note.body.length > 100 && <Text color={COLORS.secondary}>...</Text>}
                {linkedJob && <Text color={COLORS.secondary}> (job: {linkedJob.title})</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {!showForm && (
        <Box marginTop={1}>
          <Text color={COLORS.secondary}>[n] Add note [↑↓] Navigate</Text>
        </Box>
      )}
    </Box>
  );
}

import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';
import { completions } from '../commands';

/**
 * The always-focused input, Claude Code style. It only edits text: nothing acts until Enter, and
 * the store refuses anything that is not a slash command.
 *
 * ponytail: the cursor stays at the end of the line; mid-line editing comes with a real need.
 */
export function Prompt({
  onSubmit,
  onEscape,
  onArrow,
}: {
  onSubmit(line: string): void;
  onEscape(): void;
  /** When set (an overlay is open), ↑/↓ go here instead of walking the history. */
  onArrow?: (direction: -1 | 1) => void;
}) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [back, setBack] = useState(0);
  const matches = completions(value);

  useInput((input, key) => {
    if (key.return) {
      if (!value.trim()) return;
      onSubmit(value);
      // The brakes stay out of ↑ history, so a stray ↑ Enter cannot fire them again.
      if (!/^\/(stop|clear-stop)\s*$/.test(value.trim())) {
        setHistory((h) => [...h.slice(-49), value]);
      }
      setBack(0);
      setValue('');
      return;
    }
    if (key.escape) {
      if (value) setValue('');
      else onEscape();
      return;
    }
    if (key.tab) {
      if (matches.length === 1) setValue(`/${matches[0]!.name} `);
      return;
    }
    if ((key.upArrow || key.downArrow) && onArrow) {
      onArrow(key.upArrow ? -1 : 1);
      return;
    }
    if (key.upArrow || key.downArrow) {
      const next = Math.min(Math.max(back + (key.upArrow ? 1 : -1), 0), history.length);
      setBack(next);
      setValue(next === 0 ? '' : (history[history.length - next] ?? ''));
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl && input === 'u') {
      setValue('');
      return;
    }
    if (key.ctrl || key.meta || !input) return;
    setValue((v) => v + input.replace(/[\r\n]+/g, ' '));
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text wrap="truncate-start">
          <Text color="cyan">{'> '}</Text>
          {value ? <Text>{value}</Text> : <Text dimColor>/new, /send, /jobs … /help</Text>}
          <Text inverse> </Text>
        </Text>
      </Box>
      {matches.length > 0 && value.length > 1 && (
        <Box paddingX={2}>
          <Text dimColor wrap="truncate-end">
            {matches.map((m) => `/${m.name} ${m.args}`.trim()).join('   ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}

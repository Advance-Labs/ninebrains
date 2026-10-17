import type { JobSummary } from '@ninebrains/brain-core';
import { Box, Text } from 'ink';
import React from 'react';
import { COMMANDS, type Overlay } from '../commands';
import { laneLabel } from '../feed';
import { useBrainStore, type BrainStore } from '../store';
import { laneStatusColor, stateColor } from '../theme';

interface Row {
  key: string;
  cells: Array<{ text: string; color?: string; dim?: boolean; grow?: boolean }>;
}

const JOB_ORDER = [
  'running',
  'verifying',
  'claimed',
  'ready',
  'blocked',
  'failed',
  'proposed',
  'done',
];

function rowsFor(overlay: Overlay, store: BrainStore): Row[] {
  const lanes = new Map(store.lanes.map((lane) => [lane.id, lane]));
  const jobTitle = (id: string | null) => store.jobs.find((job) => job.id === id)?.title ?? '';
  switch (overlay) {
    case 'jobs':
      return [...store.jobs]
        .sort(
          (a: JobSummary, b: JobSummary) => JOB_ORDER.indexOf(a.state) - JOB_ORDER.indexOf(b.state)
        )
        .map((job) => {
          const lane = job.laneId ? lanes.get(job.laneId) : undefined;
          return {
            key: job.id,
            cells: [
              { text: job.state.padEnd(10), color: stateColor(job.state) },
              { text: job.title, grow: true },
              { text: lane ? laneLabel(lane) : '', dim: true },
              { text: job.id.slice(0, 8), dim: true },
            ],
          };
        });
    case 'lanes':
      return store.lanes.map((lane) => ({
        key: lane.id,
        cells: [
          { text: laneLabel(lane).padEnd(14) },
          { text: lane.status.padEnd(10), color: laneStatusColor(lane.status) },
          {
            text: (store.dispatcherStatus?.laneModes[lane.id] ?? 'attended').padEnd(11),
            dim: true,
          },
          { text: jobTitle(lane.activeJobId), grow: true },
        ],
      }));
    case 'notes':
      return store.notes.map((note) => ({
        key: note.id,
        cells: [{ text: note.body.replace(/\s+/g, ' '), grow: true }],
      }));
    case 'inbox':
      return store.messages.map((message) => ({
        key: message.id,
        cells: [
          { text: `${message.from.kind}:${message.from.id}`.padEnd(18), dim: true },
          // SEC-09: lane-written bodies are data. Shown as text, never acted on.
          { text: message.body.replace(/\s+/g, ' '), grow: true },
        ],
      }));
    case 'help':
      return COMMANDS.map((command) => ({
        key: command.name,
        cells: [
          { text: `/${command.name} ${command.args}`.padEnd(34), color: 'cyan' },
          { text: command.summary, dim: true, grow: true },
        ],
      }));
  }
}

const TITLES: Record<Overlay, string> = {
  jobs: 'Jobs',
  lanes: 'Lanes',
  notes: 'Notes',
  inbox: 'Inbox (now marked read)',
  help: 'Commands',
};

/** A read-only list over the feed. Esc on an empty prompt closes it; ↑/↓ scroll. */
export function OverlayView({
  overlay,
  rows,
  offset,
}: {
  overlay: Overlay;
  rows: number;
  offset: number;
}) {
  const store = useBrainStore();
  const all = rowsFor(overlay, store);
  const room = Math.max(rows - 2, 1);
  const start = Math.min(offset, Math.max(all.length - room, 0));
  const visible = all.slice(start, start + room);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>{TITLES[overlay]}</Text>
        <Text dimColor>
          {all.length === 0 ? 'empty' : `${start + 1}–${start + visible.length} of ${all.length}`} ·
          esc closes
        </Text>
      </Box>
      {visible.map((row) => (
        <Box key={row.key} paddingX={1}>
          {row.cells.map((cell, i) => (
            <Box key={i} flexGrow={cell.grow ? 1 : 0} flexShrink={cell.grow ? 1 : 0}>
              <Text color={cell.color} dimColor={cell.dim} wrap="truncate-end">
                {cell.text}{' '}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export function overlayLength(overlay: Overlay, store: BrainStore): number {
  return rowsFor(overlay, store).length;
}

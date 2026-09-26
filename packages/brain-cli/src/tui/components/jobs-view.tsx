import { Box, Text, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { useBrainStore } from '../store';
import { COLORS, stateColor, SYMBOLS } from '../theme';

export function JobsView() {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    blockJob,
    completeJob,
    requeueJob,
    assignJob,
    lanes,
  } = useBrainStore();

  const [cursor, setCursor] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const sortedJobs = [...jobs].sort((a, b) => {
    const stateOrder: Record<string, number> = {
      running: 0,
      ready: 1,
      claimed: 2,
      verifying: 3,
      blocked: 4,
      failed: 5,
      proposed: 6,
      done: 7,
    };
    return (stateOrder[a.state] ?? 99) - (stateOrder[b.state] ?? 99);
  });

  const selectedJob = sortedJobs.find((j) => j.id === selectedJobId) ?? sortedJobs[cursor] ?? null;

  useEffect(() => {
    if (selectedJob && selectedJob.id !== selectedJobId) {
      setSelectedJobId(selectedJob.id);
    }
  }, [selectedJob, selectedJobId, setSelectedJobId]);

  useInput((input, key) => {
    setActionError(null);
    setActionSuccess(null);

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(sortedJobs.length - 1, c + 1));
      return;
    }

    const job = sortedJobs[cursor];
    if (!job) return;

    if (input === 'b') {
      void (async () => {
        const res = await blockJob(job.id, 'Blocked from TUI');
        if (!res.ok) setActionError(res.error.message);
        else setActionSuccess(`Blocked ${job.id}`);
      })();
      return;
    }
    if (input === 'c') {
      void (async () => {
        const res = await completeJob(job.id, 'Completed from TUI');
        if (!res.ok) setActionError(res.error.message);
        else setActionSuccess(`Completed ${job.id}`);
      })();
      return;
    }
    if (input === 'R') {
      void (async () => {
        const res = await requeueJob(job.id);
        if (!res.ok) setActionError(res.error.message);
        else setActionSuccess(`Requeued ${job.id}`);
      })();
      return;
    }
    if (input === 'a') {
      // Assign to first idle lane, or just first lane
      const targetLane = lanes.find((l) => l.status === 'idle') ?? lanes[0];
      if (targetLane) {
        void (async () => {
          const res = await assignJob(job.id, targetLane.id);
          if (!res.ok) setActionError(res.error.message);
          else setActionSuccess(`Assigned ${job.id} to ${targetLane.id}`);
        })();
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginY={1}>
        <Text bold color={COLORS.primary}>
          Jobs
        </Text>
        <Text color={COLORS.secondary}> — {jobs.length} total</Text>
      </Box>

      {actionError && <Text color={COLORS.danger}>{actionError}</Text>}
      {actionSuccess && <Text color={COLORS.success}>{actionSuccess}</Text>}

      <Box flexGrow={1}>
        {/* Jobs list */}
        <Box flexDirection="column" width="50%" paddingRight={1}>
          <Box borderStyle="single" borderBottom paddingX={1}>
            <Text bold>Job List</Text>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            {sortedJobs.length === 0 && (
              <Text color={COLORS.secondary}>No jobs. Press n to create one.</Text>
            )}
            {sortedJobs.map((job, index) => (
              <Box key={job.id}>
                <Text>{index === cursor ? '> ' : '  '}</Text>
                <Text color={stateColor(job.state)}>{SYMBOLS.bullet} </Text>
                <Text color={COLORS.text} dimColor={job.state === 'done'}>
                  {job.title.slice(0, 40)}
                </Text>
                <Text color={COLORS.secondary}> {job.state}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Job detail */}
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          <Box borderStyle="single" borderBottom paddingX={1}>
            <Text bold>Details</Text>
          </Box>
          {selectedJob ? (
            <Box flexDirection="column" paddingX={1}>
              <Text>
                <Text bold>ID:</Text> {selectedJob.id}
              </Text>
              <Text>
                <Text bold>Title:</Text> {selectedJob.title}
              </Text>
              <Text>
                <Text bold>State:</Text>{' '}
                <Text color={stateColor(selectedJob.state)}>{selectedJob.state}</Text>
              </Text>
              <Text>
                <Text bold>Attempts:</Text> {selectedJob.attempts}
              </Text>
              {selectedJob.laneId && (
                <Text>
                  <Text bold>Lane:</Text> {selectedJob.laneId}
                </Text>
              )}
              {selectedJob.reason && (
                <Text>
                  <Text bold>Reason:</Text> {selectedJob.reason}
                </Text>
              )}
              <Box marginTop={1}>
                <Text color={COLORS.secondary}>[b]lock [c]omplete [a]ssign [R]equeue</Text>
              </Box>
            </Box>
          ) : (
            <Text color={COLORS.secondary}>Select a job to see details</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

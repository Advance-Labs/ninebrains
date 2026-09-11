import { describe, expect, it } from 'vitest';
import { aggregateLaneStatus } from '../api';
import { mapLaneSession, mapLaneStatus } from './lane-status';

describe('mapLaneStatus', () => {
  it.each([
    ['working', 'running'],
    ['awaiting-input', 'waiting'],
    ['idle', 'idle'],
    ['completed', 'idle'],
    ['error', 'blocked'],
    [undefined, 'idle'],
  ] as const)('maps hook state %s to %s', (agent, expected) => {
    expect(mapLaneStatus({ asleep: false, agent })).toBe(expected);
  });

  it('shows asleep over any hook state', () => {
    expect(mapLaneStatus({ asleep: true, agent: 'working' })).toBe('asleep');
  });

  it('lets Brain Job state override hooks', () => {
    expect(mapLaneStatus({ asleep: false, agent: 'working', job: 'verifying' })).toBe('verifying');
    expect(mapLaneStatus({ asleep: false, agent: 'idle', job: 'blocked' })).toBe('blocked');
  });
});

describe('mapLaneSession', () => {
  it('treats a missing or exited PTY as stopped', () => {
    expect(mapLaneSession(undefined)).toBe('stopped');
    expect(mapLaneSession('exited')).toBe('stopped');
    expect(mapLaneSession('starting')).toBe('starting');
    expect(mapLaneSession('running')).toBe('running');
  });
});

describe('aggregateLaneStatus', () => {
  it('picks the most urgent light', () => {
    expect(aggregateLaneStatus(['idle', 'running', 'waiting'])).toBe('waiting');
    expect(aggregateLaneStatus(['asleep', 'idle'])).toBe('idle');
    expect(aggregateLaneStatus(['asleep'])).toBe('asleep');
    expect(aggregateLaneStatus([])).toBeNull();
  });
});

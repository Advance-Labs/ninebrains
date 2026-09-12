import { describe, expect, it } from 'vitest';
import { toSidePanelItems, type LanePanelData } from './side-panel-items';

const data: LanePanelData = {
  jobs: [
    {
      id: 'j2',
      projectId: 'p1',
      title: 'Blocked one',
      state: 'blocked',
      laneId: 'A',
      attempts: 3,
      reason: 'tests keep failing',
      gates: ['tests'],
      createdByBrain: null,
      updatedAt: 20,
    },
    {
      id: 'j3',
      projectId: 'p1',
      title: 'Running one',
      state: 'running',
      laneId: 'A',
      attempts: 0,
      reason: null,
      gates: [],
      createdByBrain: 'b1',
      updatedAt: 30,
    },
  ],
  done: [
    { id: 'd1', jobId: 'j0', title: 'Old', projectId: 'p1', laneId: 'A', summary: 'did it', artifacts: [], at: 5, verified: false },
    { id: 'd2', jobId: 'j1', title: 'New', projectId: 'p1', laneId: 'A', summary: 'checked', artifacts: [], at: 9, verified: true },
  ],
  notes: [
    { id: 'n1', projectId: 'p1', jobId: null, author: { kind: 'lane', id: 'A' }, body: 'first line\nsecond', at: 1 },
  ],
};

describe('lane side panel source mapping', () => {
  it('shows jobs newest first with blocked and verifying badges', () => {
    expect(toSidePanelItems('jobs', data)).toEqual([
      { id: 'j3', title: 'Running one', detail: 'running', at: 30 },
      { id: 'j2', title: 'Blocked one', detail: 'blocked · attempt 4', at: 20, badge: 'blocked' },
    ]);
  });

  it('badges every done entry verified or unverified, never neither', () => {
    expect(toSidePanelItems('done', data).map((item) => [item.title, item.badge])).toEqual([
      ['New', 'verified'],
      ['Old', 'unverified'],
    ]);
  });

  it('shows the first line of each note', () => {
    expect(toSidePanelItems('notes', data)).toEqual([
      { id: 'n1', title: 'first line', detail: 'from this lane', at: 1 },
    ]);
  });
});

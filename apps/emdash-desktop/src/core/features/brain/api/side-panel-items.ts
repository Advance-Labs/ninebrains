import type { LaneSidePanelItem, LaneSidePanelTab } from '@core/features/lanes/api';
import type { BrainDoneView, BrainJobView, BrainNoteView } from './schemas';

export type LanePanelData = {
  jobs: readonly BrainJobView[];
  done: readonly BrainDoneView[];
  notes: readonly BrainNoteView[];
};

const newestFirst = (a: LaneSidePanelItem, b: LaneSidePanelItem) => (b.at ?? 0) - (a.at ?? 0);

/**
 * Maps the Brain's per-lane read model to the side panel's rows. Done work
 * carries a `verified` or `unverified` badge; there is no third state, so
 * work no gate checked is never shown as verified.
 */
export function toSidePanelItems(tab: LaneSidePanelTab, data: LanePanelData): LaneSidePanelItem[] {
  switch (tab) {
    case 'jobs':
      return data.jobs
        .map((job) => ({
          id: job.id,
          title: job.title,
          detail: job.attempts > 0 ? `${job.state} · attempt ${job.attempts + 1}` : job.state,
          at: job.updatedAt,
          ...(job.state === 'blocked' || job.state === 'verifying' ? { badge: job.state } : {}),
        }))
        .sort(newestFirst);
    case 'done':
      return data.done
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          detail: entry.summary,
          at: entry.at,
          badge: entry.verified ? 'verified' : 'unverified',
        }))
        .sort(newestFirst);
    case 'notes':
      return data.notes
        .map((note) => ({
          id: note.id,
          title: note.body.split('\n', 1)[0] ?? '',
          detail: note.author.kind === 'lane' ? 'from this lane' : `from ${note.author.id}`,
          at: note.at,
        }))
        .sort(newestFirst);
  }
}

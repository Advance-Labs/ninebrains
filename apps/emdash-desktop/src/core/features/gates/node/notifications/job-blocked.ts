/**
 * Notifies the user when a Brain job is blocked: after its third failed
 * verification, or when a lane or the Brain gives up on it. Calls the injected
 * notification service rather than joining the upstream producer index
 * (SEAMS §3.11).
 */
import type { BrainEmitter, Job } from '@ninebrains/brain-core';
import type { NotificationTarget, PublishNotification } from '@core/services/notifications/api';
import type { NotificationPublisher } from '../runner/ports';

export const JOB_BLOCKED_NOTIFICATION_KIND = 'ninebrains.job-blocked';

const MAX_BODY = 280;

function firstLine(text: string): string {
  const line =
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? '';
  return line.length > MAX_BODY ? `${line.slice(0, MAX_BODY - 1)}…` : line;
}

export function jobBlockedNotification(
  job: Job,
  reason: string,
  target: NotificationTarget = { kind: 'none' }
): PublishNotification {
  const why = firstLine(reason);
  return {
    kind: JOB_BLOCKED_NOTIFICATION_KIND,
    groupKey: JOB_BLOCKED_NOTIFICATION_KIND,
    title: `Job blocked: ${job.title}`,
    body: why.length > 0 ? why : 'The job needs your attention.',
    target,
    source: { kind: 'app' },
    sound: 'needs_attention',
    dedupeKey: `job-blocked:${job.id}:${job.updatedAt}`,
  };
}

export function installJobBlockedNotifications(
  service: NotificationPublisher,
  deps: {
    events: Pick<BrainEmitter, 'on'>;
    /** Maps the job's lane to its Emdash task, so clicking opens it. */
    resolveTarget?: (job: Job) => Promise<NotificationTarget | undefined>;
    onError?: (context: string, error: unknown) => void;
  }
): () => void {
  return deps.events.on('jobBlocked', ({ job, reason }) => {
    void (async () => {
      const target = (await deps.resolveTarget?.(job).catch(() => undefined)) ?? {
        kind: 'none' as const,
      };
      service.publish(jobBlockedNotification(job, reason, target));
    })().catch((error: unknown) => deps.onError?.('gates: blocked notification failed', error));
  });
}

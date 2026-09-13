import type { Job } from '@ninebrains/brain-core';

/**
 * The text a lane receives for a job, pasted (attended) or piped on stdin
 * (unattended). It carries the job and how to report back. It never includes
 * inbox bodies (SEC-09): lanes read messages through `read_inbox`.
 */
export function buildJobPrompt(job: Job): string {
  const replyTo =
    job.createdBy.kind === 'brain' && job.createdBy.id !== 'user'
      ? `Questions go to the Brain that planned it: send_message with to {"kind":"brain","id":"${job.createdBy.id}"}.`
      : 'Questions go to the user through send_message.';
  const lines = [
    `Brain job ${job.id}: ${job.title}`,
    '',
    job.body.trim() || '(no further description)',
    '',
    `This job is already assigned to you (job id ${job.id}; list_jobs with mine=true shows it).`,
    `When the work is done and checked, call complete_job with jobId "${job.id}" and a summary of what you did and how you verified it.`,
    `If you cannot finish, call block_job with jobId "${job.id}" and the reason.`,
    replyTo,
  ];
  return lines.join('\n');
}

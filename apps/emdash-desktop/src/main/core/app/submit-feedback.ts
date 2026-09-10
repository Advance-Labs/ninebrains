import { env } from '@main/lib/env';

// Ninebrains: there is no default relay. Emdash's relay (a General Action Cloudflare Worker) is
// cut, and the feedback entry points open GitHub issues instead. FEEDBACK_RELAY_URL can still
// point at a relay we own.

export interface FeedbackAttachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function submitFeedbackToRelay(args: {
  content: string;
  files: FeedbackAttachment[];
}): Promise<void> {
  const relayUrl = env.dev.FEEDBACK_RELAY_URL ?? env.build.VITE_FEEDBACK_RELAY_URL;
  if (!relayUrl) throw new Error('No feedback relay is configured for this build');

  const formData = new FormData();
  formData.append('content', args.content);
  args.files.forEach((file, index) => {
    const blob = new Blob([file.bytes.slice().buffer], {
      type: file.mimeType || 'application/octet-stream',
    });
    formData.append(`file${index}`, blob, file.filename);
  });

  const response = await fetch(relayUrl, { method: 'POST', body: formData });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Feedback relay returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}

import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';
import { brainIdSchema } from '../api';

const brainSessionsV1Schema = z.object({
  version: z.literal('1'),
  sessions: z.array(
    z.object({
      brainId: brainIdSchema,
      projectId: z.string().min(1),
      taskId: z.string().min(1),
      conversationId: z.string().min(1),
      title: z.string(),
    })
  ),
});

export const brainSessionsSchema = defineVersionedSchema()
  .initial('1', brainSessionsV1Schema)
  .build();

/**
 * Brain sessions (brain-mode `claude` conversations) and their worktree Tasks,
 * so a restarted app can mint a Brain token when a session resumes. Written
 * only by the Brain service in main. Tokens are never stored.
 */
export const brainSessionsMemento = defineMemento({
  id: 'brain.sessions',
  subject: appSubject,
  schema: brainSessionsSchema,
  default: { version: '1' as const, sessions: [] },
});

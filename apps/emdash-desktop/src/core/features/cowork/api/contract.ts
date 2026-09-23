import { defineContract, eventStream, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';

const connectionInput = z.object({
  connectionId: z.string().min(1),
  socketPath: z.string().startsWith('/').max(4096),
  token: z.string().min(32),
  path: z.string().min(1).max(4096),
});

const sessionInput = z.object({ sessionId: z.string().uuid() });

const coworkError = z.object({ code: z.string(), message: z.string() });

export const coworkEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update'),
    sessionId: z.string().uuid(),
    update: z.string(),
    revision: z.number(),
  }),
  z.object({ type: z.literal('disconnected'), sessionId: z.string().uuid() }),
]);

export type CoworkEvent = z.infer<typeof coworkEvent>;

export const coworkDomain = 'cowork' as const;

export const coworkContract = defineContract({
  events: eventStream({ key: z.void(), event: coworkEvent }),
  join: fallible({
    input: connectionInput,
    data: z.object({ sessionId: z.string().uuid(), update: z.string(), revision: z.number() }),
    error: coworkError,
  }),
  sendUpdate: fallible({
    input: sessionInput.extend({
      update: z
        .string()
        .min(1)
        .max(2 * 1024 * 1024),
    }),
    data: z.void(),
    error: coworkError,
  }),
  save: fallible({
    input: sessionInput,
    data: z.object({ content: z.string() }),
    error: coworkError,
  }),
  leave: fallible({ input: sessionInput, data: z.void(), error: coworkError }),
});

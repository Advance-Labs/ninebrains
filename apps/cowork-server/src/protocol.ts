import { z } from 'zod';

export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

const filePath = z.string().min(1).max(4096);
const update = z.string().min(1).max(MAX_FRAME_BYTES);
const requestId = z.string().min(1).max(100).optional();

export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), token: z.string(), path: filePath, requestId }),
  z.object({ type: z.literal('update'), path: filePath, update, requestId }),
  z.object({ type: z.literal('save'), path: filePath, requestId }),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

export const serverMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('joined'), path: filePath, update, revision: z.number(), requestId }),
  z.object({ type: z.literal('update'), path: filePath, update, revision: z.number(), requestId }),
  z.object({
    type: z.literal('saved'),
    path: filePath,
    revision: z.number(),
    content: z.string(),
    requestId,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    path: filePath.optional(),
    requestId,
  }),
]);

export type ServerMessage = z.infer<typeof serverMessage>;

import { ForbiddenError, InvalidInputError } from '../errors';
import { LIMITS } from '../limits';
import type { Address, Attachment, Identity, Message, Note, ProjectId, TaskId } from '../types';
import { addressOf, parseAddress } from '../types';
import { inboxAddress, loadVisibleTask, requireBrain } from './authz';
import { type BrainContext, type Tx, checkText } from './context';

export interface SendMessageInput {
  to: string;
  body: string;
  attachments?: Attachment[];
}

/**
 * Store-and-forward: the message is persisted now and stays unread until the
 * recipient reads its inbox, whether or not that lane is awake. A lane may
 * message the Brain and lanes of its own project.
 */
export function sendMessage(ctx: BrainContext, tx: Tx, identity: Identity, input: SendMessageInput): Message {
  const to = parseAddress(input.to);
  if (!to) throw new InvalidInputError(`invalid address ${input.to}: use lane:<id> or brain:<id>`);
  checkText('body', input.body, LIMITS.bodyBytes);
  const attachments = input.attachments ?? [];
  if (attachments.length > LIMITS.attachments) throw new InvalidInputError(`at most ${LIMITS.attachments} attachments`);
  if (identity.role === 'lane' && to.startsWith('lane:')) {
    const target = ctx.store.getLane(to.slice('lane:'.length));
    if (target && target.projectId !== identity.projectId) {
      throw new ForbiddenError(`lane ${identity.laneId} cannot message a lane in another project`);
    }
  }
  return deliver(ctx, tx, addressOf(identity), to, input.body, attachments);
}

/** The Brain messages every registered lane of a project. */
export function broadcast(
  ctx: BrainContext,
  tx: Tx,
  identity: Identity,
  input: { projectId: ProjectId; body: string; attachments?: Attachment[] }
): Message[] {
  requireBrain(identity, 'broadcast');
  checkText('body', input.body, LIMITS.bodyBytes);
  const from = addressOf(identity);
  return ctx.store
    .listLanes({ projectId: input.projectId })
    .map((lane) => deliver(ctx, tx, from, `lane:${lane.id}`, input.body, input.attachments ?? []));
}

/** Returns unread messages and marks them read in the same transaction. */
export function readInbox(
  ctx: BrainContext,
  identity: Identity,
  options: { address?: Address; limit?: number; includeRead?: boolean } = {}
): Message[] {
  const to = inboxAddress(identity, options.address);
  const messages = ctx.store.listMessages({ to, unreadOnly: !options.includeRead, limit: options.limit ?? 50 });
  const at = ctx.now();
  const unread = messages.filter((m) => m.readAt === null).map((m) => m.id);
  ctx.store.markMessagesRead(unread, at);
  return messages.map((m) => (m.readAt === null ? { ...m, readAt: at } : m));
}

export function addNote(
  ctx: BrainContext,
  identity: Identity,
  input: { body: string; taskId?: TaskId; projectId?: ProjectId }
): Note {
  checkText('body', input.body, LIMITS.bodyBytes);
  let projectId = identity.role === 'lane' ? identity.projectId : input.projectId;
  if (input.taskId !== undefined) {
    const task = loadVisibleTask(ctx.store, identity, input.taskId);
    projectId = task.projectId;
  }
  if (projectId === undefined) throw new InvalidInputError('a note needs a projectId or taskId');
  if (identity.role === 'lane' && projectId !== identity.projectId) {
    throw new ForbiddenError('a lane can only add notes to its own project');
  }
  const note: Note = {
    id: ctx.newId(),
    projectId,
    taskId: input.taskId ?? null,
    author: addressOf(identity),
    body: input.body,
    createdAt: ctx.now(),
  };
  ctx.store.insertNote(note);
  return note;
}

function deliver(
  ctx: BrainContext,
  tx: Tx,
  from: Address,
  to: Address,
  body: string,
  attachments: Attachment[]
): Message {
  const message: Message = { id: ctx.newId(), from, to, body, attachments, createdAt: ctx.now(), readAt: null };
  ctx.store.insertMessage(message);
  tx.raise({ type: 'messageSent', payload: { message } });
  return message;
}

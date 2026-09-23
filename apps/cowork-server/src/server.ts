import { timingSafeEqual } from 'node:crypto';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { CoworkDocuments, CoworkError } from './documents';
import { clientMessage, MAX_FRAME_BYTES, type ServerMessage } from './protocol';

type Peer = { socket: Socket; joined: Set<string>; authorized: boolean };

export type CoworkServerOptions = {
  root: string;
  stateDir: string;
  socketPath: string;
  token: string;
};

export type CoworkServerHandle = { close(): Promise<void> };

function sameToken(expected: Buffer, candidate: string): boolean {
  const received = Buffer.from(candidate);
  return received.length === expected.length && timingSafeEqual(expected, received);
}

/** Serve a narrow text-only protocol on a group-accessible Unix socket. */
export async function startCoworkServer(options: CoworkServerOptions): Promise<CoworkServerHandle> {
  if (Buffer.byteLength(options.token) < 32) {
    throw new CoworkError('invalid-token', 'Session token must contain at least 32 bytes');
  }
  const socketDir = dirname(options.socketPath);
  const dirStat = await lstat(socketDir);
  if (
    !dirStat.isDirectory() ||
    (dirStat.mode & 0o022) !== 0 ||
    (process.getuid && dirStat.uid !== process.getuid())
  ) {
    throw new CoworkError(
      'invalid-socket-dir',
      'Socket directory must be owned by the server account and not group or world writable'
    );
  }
  const documents = await CoworkDocuments.open(options.root, options.stateDir);
  const peers = new Set<Peer>();
  let operations = Promise.resolve();
  const token = Buffer.from(options.token);
  const server = createServer((socket) => {
    if (peers.size >= 8) {
      socket.destroy();
      return;
    }
    const peer: Peer = {
      socket,
      joined: new Set(),
      authorized: false,
    };
    peers.add(peer);
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      input += chunk;
      if (Buffer.byteLength(input) > MAX_FRAME_BYTES) {
        send(peer, { type: 'error', code: 'too-large', message: 'Request is too large' });
        socket.destroy();
        return;
      }
      let boundary = input.indexOf('\n');
      while (boundary >= 0) {
        const line = input.slice(0, boundary);
        input = input.slice(boundary + 1);
        operations = operations
          .then(() => handle(line, peer))
          .catch((error: unknown) => {
            const typed =
              error instanceof CoworkError
                ? error
                : new CoworkError('internal', 'Internal collaboration error');
            const requestId = requestIdFromLine(line);
            send(peer, {
              type: 'error',
              code: typed.code,
              message: typed.message,
              ...(requestId ? { requestId } : {}),
            });
          });
        boundary = input.indexOf('\n');
      }
    });
    socket.on('close', () => {
      peers.delete(peer);
      operations = operations.then(async () => {
        for (const path of peer.joined) {
          if (![...peers].some((other) => other.joined.has(path))) {
            await documents.release(path);
          }
        }
      });
    });
    socket.on('error', () => socket.destroy());
  });

  async function handle(line: string, peer: Peer): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new CoworkError('invalid-request', 'Request must be JSON');
    }
    const parsed = clientMessage.safeParse(raw);
    if (!parsed.success) throw new CoworkError('invalid-request', 'Invalid request shape');
    const message = parsed.data;
    if (message.type === 'join') {
      if (!sameToken(token, message.token)) {
        throw new CoworkError('unauthorized', 'Invalid session capability');
      }
      peer.authorized = true;
      const joined = await documents.join(message.path);
      peer.joined.add(joined.path);
      send(peer, {
        type: 'joined',
        path: message.path,
        update: Buffer.from(joined.update).toString('base64'),
        revision: joined.revision,
        requestId: message.requestId,
      });
      return;
    }
    if (!peer.authorized || !peer.joined.has(await resolveJoinedPath(message.path, peer))) {
      throw new CoworkError('unauthorized', 'Join this document first');
    }
    if (message.type === 'update') {
      const bytes = Buffer.from(message.update, 'base64');
      const result = await documents.update(message.path, bytes);
      for (const target of peers) {
        if (!target.joined.has(result.path)) continue;
        send(target, {
          type: 'update',
          path: message.path,
          update: message.update,
          revision: result.revision,
          requestId: target === peer ? message.requestId : undefined,
        });
      }
      return;
    }
    const saved = await documents.save(message.path);
    for (const target of peers) {
      if (target.joined.has(saved.path)) {
        send(target, {
          type: 'saved',
          path: message.path,
          revision: saved.revision,
          content: saved.content,
          requestId: target === peer ? message.requestId : undefined,
        });
      }
    }
  }

  // Resolve by joining only after authorization. The canonical path identity
  // comes from the document store, so spelling aliases cannot bypass join.
  async function resolveJoinedPath(path: string, peer: Peer): Promise<string> {
    if (!peer.authorized) return '';
    const joined = await documents.join(path);
    return joined.path;
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    await chmod(options.socketPath, 0o660);
  } catch (error) {
    await closeServer(server);
    await unlink(options.socketPath).catch(() => {});
    throw error;
  }
  return {
    async close() {
      for (const peer of peers) peer.socket.destroy();
      await closeServer(server);
      await operations;
      await unlink(options.socketPath).catch(() => {});
    },
  };
}

function send(peer: Peer, message: ServerMessage): void {
  if (!peer.socket.destroyed) peer.socket.write(`${JSON.stringify(message)}\n`);
}

function requestIdFromLine(line: string): string | undefined {
  try {
    const value = JSON.parse(line) as { requestId?: unknown };
    return typeof value.requestId === 'string' && value.requestId.length <= 100
      ? value.requestId
      : undefined;
  } catch {
    return undefined;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

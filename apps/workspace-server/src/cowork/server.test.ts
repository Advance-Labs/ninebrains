import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ServerMessage } from './protocol';
import { startCoworkServer, type CoworkServerHandle } from './server';

type Client = {
  send(message: unknown): void;
  next(): Promise<ServerMessage>;
  close(): void;
};

let base: string;
let root: string;
let stateDir: string;
let socketPath: string;
let server: CoworkServerHandle;
const token = 'ninebrains-cowork-test-capability-0123456789';

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'ninebrains-cowork-'));
  root = join(base, 'worktree');
  stateDir = join(base, 'state');
  await mkdir(root);
  await mkdir(stateDir, { mode: 0o700 });
  await writeFile(join(root, 'shared.txt'), 'start');
  socketPath = join(base, 'cowork.sock');
  server = await startCoworkServer({ root, stateDir, socketPath, token });
});

afterEach(async () => {
  await server.close();
  await rm(base, { recursive: true, force: true });
});

describe('cowork server', () => {
  it('restricts the shared socket to owner and group', async () => {
    expect((await stat(socketPath)).mode & 0o777).toBe(0o660);
  });

  it('rejects socket directories peers can replace and state directories peers can modify', async () => {
    const unsafeSocketDir = join(base, 'unsafe-socket');
    await mkdir(unsafeSocketDir);
    await chmod(unsafeSocketDir, 0o770);
    await expect(
      startCoworkServer({ root, stateDir, socketPath: join(unsafeSocketDir, 'cowork.sock'), token })
    ).rejects.toMatchObject({ code: 'invalid-socket-dir' });

    const unsafeStateDir = join(base, 'unsafe-state');
    await mkdir(unsafeStateDir);
    await chmod(unsafeStateDir, 0o770);
    await expect(
      startCoworkServer({
        root,
        stateDir: unsafeStateDir,
        socketPath: join(base, 'other.sock'),
        token,
      })
    ).rejects.toMatchObject({ code: 'invalid-state' });

    const nestedStateDir = join(root, 'private-state');
    await mkdir(nestedStateDir, { mode: 0o700 });
    await expect(
      startCoworkServer({
        root,
        stateDir: nestedStateDir,
        socketPath: join(base, 'other.sock'),
        token,
      })
    ).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('synchronizes two editors and saves their merged text', async () => {
    const alice = await connect(socketPath);
    const bob = await connect(socketPath);
    try {
      alice.send({ type: 'join', token, path: 'shared.txt', requestId: 'alice-join' });
      bob.send({ type: 'join', token, path: 'shared.txt' });
      const aliceJoin = await alice.next();
      const bobJoin = await bob.next();
      expect(aliceJoin.type).toBe('joined');
      expect(aliceJoin.requestId).toBe('alice-join');
      expect(bobJoin.type).toBe('joined');
      if (aliceJoin.type !== 'joined' || bobJoin.type !== 'joined') return;

      const aliceDoc = new Y.Doc();
      const bobDoc = new Y.Doc();
      Y.applyUpdate(aliceDoc, Buffer.from(aliceJoin.update, 'base64'));
      Y.applyUpdate(bobDoc, Buffer.from(bobJoin.update, 'base64'));
      const initial = Y.encodeStateVector(aliceDoc);
      aliceDoc.getText('content').insert(5, ' Alice');
      const aliceUpdate = Y.encodeStateAsUpdate(aliceDoc, initial);
      alice.send({
        type: 'update',
        path: 'shared.txt',
        update: Buffer.from(aliceUpdate).toString('base64'),
        requestId: 'alice-update',
      });
      expect(await alice.next()).toMatchObject({ type: 'update', requestId: 'alice-update' });
      const first = await bob.next();
      expect(first.type).toBe('update');
      if (first.type !== 'update') return;
      Y.applyUpdate(bobDoc, Buffer.from(first.update, 'base64'));
      const bobVector = Y.encodeStateVector(bobDoc);
      bobDoc.getText('content').insert(0, 'Bob ');
      expect(bobDoc.getText('content').toString()).toBe('Bob start Alice');
      bob.send({
        type: 'update',
        path: 'shared.txt',
        update: Buffer.from(Y.encodeStateAsUpdate(bobDoc, bobVector)).toString('base64'),
      });
      await bob.next(); // Bob receives his own update.
      const second = await alice.next();
      expect(second.type).toBe('update');
      if (second.type !== 'update') return;
      expect(second.update).not.toBe(first.update);
      Y.applyUpdate(aliceDoc, Buffer.from(second.update, 'base64'));
      expect(aliceDoc.getText('content').toString()).toBe('Bob start Alice');
      expect(bobDoc.getText('content').toString()).toBe('Bob start Alice');

      alice.send({ type: 'save', path: 'shared.txt', requestId: 'alice-save' });
      expect(await alice.next()).toMatchObject({
        type: 'saved',
        requestId: 'alice-save',
        content: 'Bob start Alice',
      });
      expect(await readFile(join(root, 'shared.txt'), 'utf8')).toBe('Bob start Alice');
    } finally {
      alice.close();
      bob.close();
    }
  });

  it('merges offline edits with changes made by a connected peer on rejoin', async () => {
    const alice = await connect(socketPath);
    const bob = await connect(socketPath);
    let rejoined: Client | undefined;
    try {
      alice.send({ type: 'join', token, path: 'shared.txt' });
      bob.send({ type: 'join', token, path: 'shared.txt' });
      const aliceSnapshot = await alice.next();
      const bobSnapshot = await bob.next();
      expect(aliceSnapshot.type).toBe('joined');
      expect(bobSnapshot.type).toBe('joined');
      if (aliceSnapshot.type !== 'joined' || bobSnapshot.type !== 'joined') return;
      const aliceDoc = new Y.Doc();
      const bobDoc = new Y.Doc();
      Y.applyUpdate(aliceDoc, Buffer.from(aliceSnapshot.update, 'base64'));
      Y.applyUpdate(bobDoc, Buffer.from(bobSnapshot.update, 'base64'));
      alice.close();

      const bobVector = Y.encodeStateVector(bobDoc);
      bobDoc.getText('content').insert(5, ' Bob');
      bob.send({
        type: 'update',
        path: 'shared.txt',
        update: Buffer.from(Y.encodeStateAsUpdate(bobDoc, bobVector)).toString('base64'),
      });
      expect((await bob.next()).type).toBe('update');
      aliceDoc.getText('content').insert(0, 'Alice ');

      rejoined = await connect(socketPath);
      rejoined.send({ type: 'join', token, path: 'shared.txt' });
      const snapshot = await rejoined.next();
      expect(snapshot.type).toBe('joined');
      if (snapshot.type !== 'joined') return;
      Y.applyUpdate(aliceDoc, Buffer.from(snapshot.update, 'base64'));
      rejoined.send({
        type: 'update',
        path: 'shared.txt',
        update: Buffer.from(Y.encodeStateAsUpdate(aliceDoc)).toString('base64'),
      });
      expect((await rejoined.next()).type).toBe('update');
      const merged = await bob.next();
      expect(merged.type).toBe('update');
      if (merged.type !== 'update') return;
      Y.applyUpdate(bobDoc, Buffer.from(merged.update, 'base64'));
      expect(aliceDoc.getText('content').toString()).toBe('Alice start Bob');
      expect(bobDoc.getText('content').toString()).toBe('Alice start Bob');
    } finally {
      alice.close();
      bob.close();
      rejoined?.close();
    }
  });

  it('rejects unauthorized joins, path traversal, and symlink escapes', async () => {
    const client = await connect(socketPath);
    try {
      client.send({ type: 'join', token: 'wrong', path: 'shared.txt' });
      expect(await client.next()).toMatchObject({ type: 'error', code: 'unauthorized' });
      client.send({ type: 'join', token, path: '../state/secret.txt' });
      expect(await client.next()).toMatchObject({ type: 'error', code: 'invalid-path' });
      await symlink(join(base, 'state'), join(root, 'escape'));
      await writeFile(join(base, 'state', 'secret.txt'), 'secret');
      client.send({ type: 'join', token, path: 'escape/secret.txt' });
      expect(await client.next()).toMatchObject({ type: 'error', code: 'invalid-path' });
    } finally {
      client.close();
    }
  });

  it('refuses to save over an external disk change', async () => {
    const client = await connect(socketPath);
    try {
      client.send({ type: 'join', token, path: 'shared.txt' });
      expect((await client.next()).type).toBe('joined');
      await writeFile(join(root, 'shared.txt'), 'agent wrote');
      client.send({ type: 'save', path: 'shared.txt' });
      expect(await client.next()).toMatchObject({ type: 'error', code: 'external-change' });
      expect(await readFile(join(root, 'shared.txt'), 'utf8')).toBe('agent wrote');
    } finally {
      client.close();
    }
  });

  it('does not follow a file replaced with a symlink before Save', async () => {
    const client = await connect(socketPath);
    try {
      client.send({ type: 'join', token, path: 'shared.txt' });
      expect((await client.next()).type).toBe('joined');
      const outside = join(base, 'outside.txt');
      await writeFile(outside, 'outside');
      await rm(join(root, 'shared.txt'));
      await symlink(outside, join(root, 'shared.txt'));
      client.send({ type: 'save', path: 'shared.txt' });
      expect(await client.next()).toMatchObject({ type: 'error', code: 'invalid-path' });
      expect(await readFile(outside, 'utf8')).toBe('outside');
    } finally {
      client.close();
    }
  });

  it('preserves unsaved document state across restart and detects outside writes', async () => {
    const client = await connect(socketPath);
    client.send({ type: 'join', token, path: 'shared.txt' });
    const joined = await client.next();
    expect(joined.type).toBe('joined');
    if (joined.type !== 'joined') return;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(joined.update, 'base64'));
    const vector = Y.encodeStateVector(doc);
    doc.getText('content').insert(5, ' unsaved');
    client.send({
      type: 'update',
      path: 'shared.txt',
      update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64'),
    });
    expect((await client.next()).type).toBe('update');
    client.close();
    await server.close();
    server = await startCoworkServer({ root, stateDir, socketPath, token });
    const recovered = await connect(socketPath);
    recovered.send({ type: 'join', token, path: 'shared.txt' });
    const snapshot = await recovered.next();
    expect(snapshot.type).toBe('joined');
    if (snapshot.type !== 'joined') return;
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Buffer.from(snapshot.update, 'base64'));
    expect(reopened.getText('content').toString()).toBe('start unsaved');
    recovered.close();
    await server.close();
    await writeFile(join(root, 'shared.txt'), 'changed while offline');
    server = await startCoworkServer({ root, stateDir, socketPath, token });
    const stale = await connect(socketPath);
    stale.send({ type: 'join', token, path: 'shared.txt' });
    expect(await stale.next()).toMatchObject({ type: 'error', code: 'external-change' });
    stale.close();
  });

  it('does not make a document resident when the peer has not joined it', async () => {
    // Rejecting an unjoined path must not load it: nothing would ever release a
    // document no peer joined, so the resident cap would fill and stay full.
    for (let index = 0; index < 140; index += 1) {
      await writeFile(join(root, `other-${index}.txt`), 'x');
    }
    const client = await connect(socketPath);
    try {
      client.send({ type: 'join', token, path: 'shared.txt' });
      expect((await client.next()).type).toBe('joined');

      for (let index = 0; index < 140; index += 1) {
        client.send({ type: 'save', path: `other-${index}.txt`, requestId: `probe-${index}` });
        expect(await client.next()).toMatchObject({
          type: 'error',
          code: 'unauthorized',
          requestId: `probe-${index}`,
        });
      }

      // The server is still usable: the probes left nothing resident.
      const joiner = await connect(socketPath);
      try {
        joiner.send({ type: 'join', token, path: 'other-0.txt' });
        expect(await joiner.next()).toMatchObject({ type: 'joined', path: 'other-0.txt' });
      } finally {
        joiner.close();
      }
    } finally {
      client.close();
    }
  });

  it('bounds each frame rather than the whole read buffer', async () => {
    // Two legal frames can arrive in one read and together exceed MAX_FRAME_BYTES.
    // Guarding the accumulated buffer would drop a peer that did nothing wrong.
    const client = await connect(socketPath);
    try {
      client.send({ type: 'join', token, path: 'shared.txt' });
      expect((await client.next()).type).toBe('joined');

      const payload = 'A'.repeat(1_200_000);
      client.send({ type: 'update', path: 'shared.txt', update: payload, requestId: 'first' });
      client.send({ type: 'update', path: 'shared.txt', update: payload, requestId: 'second' });

      // Both frames are answered on their own merits instead of killing the peer.
      expect(await client.next()).toMatchObject({ type: 'update', requestId: 'first' });
      expect(await client.next()).toMatchObject({ type: 'update', requestId: 'second' });
    } finally {
      client.close();
    }
  });

  it('reports and drops a peer that sends a frame larger than the limit', async () => {
    // Raw socket: the server tears this peer down while it is still writing, so
    // the shared helper's connect/reject wiring would surface a spurious EPIPE.
    const socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    socket.setEncoding('utf8');
    let received = '';
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    socket.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

    socket.write(`${JSON.stringify({ type: 'join', token, path: 'shared.txt' })}\n`);
    socket.write(
      `${JSON.stringify({ type: 'update', path: 'shared.txt', update: 'A'.repeat(2_200_000) })}\n`
    );

    await closed;
    // The peer is dropped and the oversized frame never reaches the document.
    // The error frame is best-effort only: the reset can discard it while the
    // peer is still uploading, so asserting delivery here would be flaky.
    expect(received).not.toContain('"type":"update"');
  });

  it('labels broadcasts with the worktree-relative name, not the sender spelling', async () => {
    const alice = await connect(socketPath);
    const bob = await connect(socketPath);
    try {
      // Alice reaches the same document by a different but equivalent spelling.
      alice.send({ type: 'join', token, path: './shared.txt' });
      bob.send({ type: 'join', token, path: 'shared.txt' });
      const aliceJoin = await alice.next();
      const bobJoin = await bob.next();
      expect(aliceJoin).toMatchObject({ type: 'joined', path: 'shared.txt' });
      expect(bobJoin).toMatchObject({ type: 'joined', path: 'shared.txt' });
      if (aliceJoin.type !== 'joined') return;

      const doc = new Y.Doc();
      Y.applyUpdate(doc, Buffer.from(aliceJoin.update, 'base64'));
      const vector = Y.encodeStateVector(doc);
      doc.getText('content').insert(5, ' edit');
      alice.send({
        type: 'update',
        path: './shared.txt',
        update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64'),
      });

      expect(await alice.next()).toMatchObject({ type: 'update', path: 'shared.txt' });
      expect(await bob.next()).toMatchObject({ type: 'update', path: 'shared.txt' });

      alice.send({ type: 'save', path: './shared.txt' });
      expect(await alice.next()).toMatchObject({ type: 'saved', path: 'shared.txt' });
      expect(await bob.next()).toMatchObject({ type: 'saved', path: 'shared.txt' });
    } finally {
      alice.close();
      bob.close();
    }
  });
});

async function connect(path: string): Promise<Client> {
  const socket = createConnection(path);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const messages: ServerMessage[] = [];
  const waiters: Array<(message: ServerMessage) => void> = [];
  let input = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    input += chunk;
    let newline = input.indexOf('\n');
    while (newline >= 0) {
      const message = JSON.parse(input.slice(0, newline)) as ServerMessage;
      input = input.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
      newline = input.indexOf('\n');
    }
  });
  return {
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    next() {
      const message = messages.shift();
      if (message) return Promise.resolve(message);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      socket.destroy();
    },
  };
}

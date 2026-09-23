import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { CoworkEvent } from '../api';
import { CoworkService } from './cowork-service';

class TestSocket extends Duplex {
  private input = '';
  readonly requests: Array<Record<string, string>> = [];

  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.input += chunk.toString('utf8');
    let boundary = this.input.indexOf('\n');
    while (boundary >= 0) {
      const request = JSON.parse(this.input.slice(0, boundary)) as Record<string, string>;
      this.requests.push(request);
      this.input = this.input.slice(boundary + 1);
      if (request.type === 'join') {
        this.respond({
          type: 'joined',
          path: request.path,
          requestId: request.requestId,
          update: 'AA==',
          revision: 0,
        });
      }
      boundary = this.input.indexOf('\n');
    }
    callback();
  }

  respond(message: Record<string, unknown>): void {
    this.push(`${JSON.stringify(message)}\n`);
  }
}

describe('CoworkService', () => {
  it('correlates concurrent update and save replies and emits peer changes', async () => {
    const socket = new TestSocket();
    const events: CoworkEvent[] = [];
    const service = new CoworkService(
      async () => socket,
      (event) => events.push(event)
    );
    const joined = await service.join({
      connectionId: 'ssh-1',
      socketPath: '/shared/cowork.sock',
      token: 'test-token-with-at-least-thirty-two-bytes',
      path: 'src/file.ts',
    });
    expect(joined.success).toBe(true);
    if (!joined.success) return;

    const first = service.sendUpdate({ sessionId: joined.data.sessionId, update: 'AQ==' });
    const second = service.sendUpdate({ sessionId: joined.data.sessionId, update: 'Ag==' });
    const updates = socket.requests.filter((request) => request.type === 'update');
    expect(updates).toHaveLength(2);
    socket.respond({
      type: 'update',
      path: 'src/file.ts',
      requestId: updates[1].requestId,
      update: 'Ag==',
      revision: 2,
    });
    socket.respond({
      type: 'update',
      path: 'src/file.ts',
      requestId: updates[0].requestId,
      update: 'AQ==',
      revision: 1,
    });
    expect(await first).toMatchObject({ success: true });
    expect(await second).toMatchObject({ success: true });
    expect(events).toHaveLength(2);

    const save = service.save({ sessionId: joined.data.sessionId });
    const saveRequest = socket.requests.find((request) => request.type === 'save');
    expect(saveRequest).toBeDefined();
    socket.respond({
      type: 'saved',
      requestId: saveRequest?.requestId,
      revision: 2,
      path: 'src/file.ts',
      content: 'merged text',
    });
    expect(await save).toEqual({ success: true, data: { content: 'merged text' } });
    service.dispose();
    expect(events.at(-1)).toMatchObject({
      type: 'disconnected',
      sessionId: joined.data.sessionId,
    });
  });
});

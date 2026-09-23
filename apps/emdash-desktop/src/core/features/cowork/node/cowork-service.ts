import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { err, ok, type Result } from '@emdash/shared';
import { serverMessage, type ServerMessage } from '@ninebrains/cowork-server/protocol';
import type { CoworkEvent } from '../api';

type Failure = { code: string; message: string };

type Pending = {
  resolve: (message: ServerMessage) => void;
  reject: (error: Failure) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Session = {
  id: string;
  path: string;
  stream: Duplex;
  input: string;
  pending: Map<string, Pending>;
};

export class CoworkService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly openSocket: (connectionId: string, socketPath: string) => Promise<Duplex>,
    private readonly emit: (event: CoworkEvent) => void
  ) {}

  async join(input: {
    connectionId: string;
    socketPath: string;
    token: string;
    path: string;
  }): Promise<Result<{ sessionId: string; update: string; revision: number }, Failure>> {
    let stream: Duplex;
    try {
      stream = await this.openSocket(input.connectionId, input.socketPath);
    } catch (error) {
      return err({ code: 'connection-failed', message: describe(error) });
    }
    const session: Session = {
      id: randomUUID(),
      path: input.path,
      stream,
      input: '',
      pending: new Map(),
    };
    this.sessions.set(session.id, session);
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => this.receive(session, chunk));
    stream.on('error', () => this.disconnect(session));
    stream.on('close', () => this.disconnect(session));
    try {
      const response = await this.request(session, {
        type: 'join',
        token: input.token,
        path: input.path,
      });
      if (response.type !== 'joined') {
        throw { code: 'invalid-response', message: 'Expected a document snapshot' };
      }
      return ok({ sessionId: session.id, update: response.update, revision: response.revision });
    } catch (error) {
      this.disconnect(session);
      return err(asFailure(error));
    }
  }

  async sendUpdate(input: { sessionId: string; update: string }): Promise<Result<void, Failure>> {
    const session = this.sessions.get(input.sessionId);
    if (!session) return err({ code: 'disconnected', message: 'Cowork session is disconnected' });
    try {
      const response = await this.request(session, {
        type: 'update',
        path: session.path,
        update: input.update,
      });
      if (response.type !== 'update') {
        throw { code: 'invalid-response', message: 'Expected a document update acknowledgement' };
      }
      return ok(undefined);
    } catch (error) {
      return err(asFailure(error));
    }
  }

  async save(input: { sessionId: string }): Promise<Result<{ content: string }, Failure>> {
    const session = this.sessions.get(input.sessionId);
    if (!session) return err({ code: 'disconnected', message: 'Cowork session is disconnected' });
    try {
      const response = await this.request(session, { type: 'save', path: session.path });
      if (response.type !== 'saved') {
        throw { code: 'invalid-response', message: 'Expected a save acknowledgement' };
      }
      return ok({ content: response.content });
    } catch (error) {
      return err(asFailure(error));
    }
  }

  leave(input: { sessionId: string }): Result<void, Failure> {
    const session = this.sessions.get(input.sessionId);
    if (session) this.disconnect(session);
    return ok(undefined);
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.disconnect(session);
  }

  private request(session: Session, message: Record<string, string>): Promise<ServerMessage> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestId);
        reject({ code: 'timeout', message: 'Cowork request timed out' });
      }, 15_000);
      session.pending.set(requestId, { resolve, reject, timer });
      session.stream.write(`${JSON.stringify({ ...message, requestId })}\n`, (error) => {
        if (!error) return;
        const pending = session.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pending.delete(requestId);
        pending.reject({ code: 'connection-failed', message: describe(error) });
      });
    });
  }

  private receive(session: Session, chunk: string): void {
    if (!this.sessions.has(session.id)) return;
    session.input += chunk;
    if (Buffer.byteLength(session.input) > 3 * 1024 * 1024) {
      this.disconnect(session);
      return;
    }
    let newline = session.input.indexOf('\n');
    while (newline >= 0) {
      const line = session.input.slice(0, newline);
      session.input = session.input.slice(newline + 1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.disconnect(session);
        return;
      }
      const result = serverMessage.safeParse(parsed);
      if (!result.success) {
        this.disconnect(session);
        return;
      }
      this.handleMessage(session, result.data);
      newline = session.input.indexOf('\n');
    }
  }

  private handleMessage(session: Session, message: ServerMessage): void {
    if (message.type === 'update') {
      this.emit({
        type: 'update',
        sessionId: session.id,
        update: message.update,
        revision: message.revision,
      });
    }
    if (!message.requestId) return;
    const pending = session.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    session.pending.delete(message.requestId);
    if (message.type === 'error') pending.reject({ code: message.code, message: message.message });
    else pending.resolve(message);
  }

  private disconnect(session: Session): void {
    if (!this.sessions.delete(session.id)) return;
    session.stream.destroy();
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject({ code: 'disconnected', message: 'Cowork session disconnected' });
    }
    session.pending.clear();
    this.emit({ type: 'disconnected', sessionId: session.id });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asFailure(error: unknown): Failure {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) };
  }
  return { code: 'internal', message: describe(error) };
}

import { err, ok, type Result } from '@emdash/shared';
import type { BrainError, BrainSessionView } from '../api';

/**
 * Brain sessions: `claude` PTY conversations launched in brain mode (SEAMS §3.9).
 * Each one gets its own worktree Task, like a lane, so its sandbox write scope
 * is a checkout it owns, and a Brain-role token minted for it alone. Lanes
 * reply to `{ kind: 'brain', id: <brainId> }`, which routes to this session.
 */

export interface StoredBrainSession {
  brainId: string;
  projectId: string;
  taskId: string;
  conversationId: string;
  title: string;
}

/** Structurally the lanes slice's ports, bound by the composition root. */
export interface BrainSessionPorts {
  projects: {
    get(projectId: string): Promise<{
      projectId: string;
      name: string;
      host: 'local' | 'remote';
      baseRef: string | null;
    } | null>;
  };
  tasks: {
    createWorktreeTask(input: {
      taskId: string;
      projectId: string;
      name: string;
      branchName: string;
      baseRef: string;
    }): Promise<Result<void, string>>;
    provision(taskId: string): Promise<Result<{ path: string }, string>>;
  };
  conversations: {
    create(input: {
      conversationId: string;
      projectId: string;
      taskId: string;
      provider: 'claude' | 'codex';
      model: string | null;
      title: string;
    }): Promise<void>;
    launch(input: { conversationId: string; projectId: string; taskId: string }): Promise<void>;
    stop(conversationId: string): Promise<void>;
  };
  persistence: {
    load(): Promise<StoredBrainSession[] | null>;
    save(sessions: StoredBrainSession[]): Promise<void>;
  };
  newId(): string;
  onError(context: string, error: unknown): void;
}

type Runtime = {
  status: BrainSessionView['status'];
  error: string | null;
  worktree: string | null;
};

const brainError = (type: BrainError['type'], message: string): BrainError => ({ type, message });

export class BrainSessions {
  private sessions: StoredBrainSession[] = [];
  private readonly runtime = new Map<string, Runtime>();
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly ports: BrainSessionPorts,
    /** Revokes the session's token and deletes its launch files. */
    private readonly release: (brainId: string) => void
  ) {}

  initialize(): Promise<void> {
    this.loaded ??= this.ports.persistence
      .load()
      .then((stored) => {
        this.sessions = stored ?? [];
        this.notify();
      })
      .catch((error: unknown) => this.ports.onError('brain: sessions load failed', error));
    return this.loaded;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): BrainSessionView[] {
    return this.sessions.map((session) => {
      const runtime = this.runtime.get(session.brainId);
      return {
        ...session,
        status: runtime?.status ?? 'stopped',
        error: runtime?.error ?? null,
      };
    });
  }

  ids(): string[] {
    return this.sessions.map((session) => session.brainId);
  }

  byConversation(conversationId: string): StoredBrainSession | undefined {
    return this.sessions.find((session) => session.conversationId === conversationId);
  }

  worktreeOf(brainId: string): string | null {
    return this.runtime.get(brainId)?.worktree ?? null;
  }

  async start(projectId: string): Promise<Result<{ brainId: string }, BrainError>> {
    await this.initialize();
    const project = await this.ports.projects.get(projectId);
    if (!project) return err(brainError('not-found', 'That project no longer exists.'));
    if (project.host !== 'local') {
      return err(brainError('unavailable', 'Brain sessions run on this machine only for now.'));
    }
    const brainId = this.ports.newId();
    const session: StoredBrainSession = {
      brainId,
      projectId,
      taskId: this.ports.newId(),
      conversationId: this.ports.newId(),
      title: `Brain ${this.sessions.length + 1}`,
    };
    this.setRuntime(brainId, { status: 'starting', error: null, worktree: null });
    const created = await this.ports.tasks.createWorktreeTask({
      taskId: session.taskId,
      projectId,
      name: `${project.name} · ${session.title}`,
      branchName: `brain/${brainId.slice(0, 8)}`,
      baseRef: project.baseRef ?? 'main',
    });
    if (!created.success) {
      this.setRuntime(brainId, { status: 'failed', error: created.error, worktree: null });
      return err(brainError('internal', created.error));
    }
    this.sessions.push(session);
    this.persist();
    const launched = await this.launch(session, true);
    return launched.success ? ok({ brainId }) : launched;
  }

  async resume(brainId: string): Promise<Result<void, BrainError>> {
    await this.initialize();
    const session = this.sessions.find((candidate) => candidate.brainId === brainId);
    if (!session) return err(brainError('not-found', 'That Brain session no longer exists.'));
    const launched = await this.launch(session, false);
    return launched.success ? ok(undefined) : launched;
  }

  async stop(brainId: string): Promise<Result<void, BrainError>> {
    await this.initialize();
    const session = this.sessions.find((candidate) => candidate.brainId === brainId);
    if (!session) return err(brainError('not-found', 'That Brain session no longer exists.'));
    try {
      await this.ports.conversations.stop(session.conversationId);
    } catch (error) {
      this.ports.onError('brain: session stop failed', error);
    }
    this.release(brainId);
    this.setRuntime(brainId, {
      status: 'stopped',
      error: null,
      worktree: this.worktreeOf(brainId),
    });
    return ok(undefined);
  }

  private async launch(
    session: StoredBrainSession,
    fresh: boolean
  ): Promise<Result<{ brainId: string }, BrainError>> {
    const { brainId } = session;
    this.setRuntime(brainId, { status: 'starting', error: null, worktree: null });
    try {
      const provisioned = await this.ports.tasks.provision(session.taskId);
      if (!provisioned.success) throw new Error(provisioned.error);
      this.setRuntime(brainId, {
        status: 'starting',
        error: null,
        worktree: provisioned.data.path,
      });
      const ids = {
        conversationId: session.conversationId,
        projectId: session.projectId,
        taskId: session.taskId,
      };
      if (fresh) {
        await this.ports.conversations.create({
          ...ids,
          provider: 'claude',
          model: null,
          title: session.title,
        });
      } else {
        await this.ports.conversations.launch(ids);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setRuntime(brainId, {
        status: 'failed',
        error: message,
        worktree: this.worktreeOf(brainId),
      });
      return err(brainError('internal', message));
    }
    this.setRuntime(brainId, {
      status: 'running',
      error: null,
      worktree: this.worktreeOf(brainId),
    });
    return ok({ brainId });
  }

  private setRuntime(brainId: string, runtime: Runtime): void {
    this.runtime.set(brainId, runtime);
    this.notify();
  }

  private persist(): void {
    void this.ports.persistence
      .save(this.sessions.map((session) => ({ ...session })))
      .catch((error: unknown) => this.ports.onError('brain: sessions save failed', error));
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

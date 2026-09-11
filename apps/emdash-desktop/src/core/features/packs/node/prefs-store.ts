import { projectSubject } from '@core/features/projects/contributions/subject';
import { appSubject } from '@core/primitives/subjects/api';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { packsPrefsIndexMemento, packsProjectPrefsMemento } from '../contributions/mementos';

/**
 * Per-project pack toggles. Kept behind this port so storage can move to the
 * Brain DB (`project_prefs`) once it exists without touching callers.
 */
export interface PackPrefsStore {
  getEnabled(projectId: string): Promise<string[]>;
  setEnabled(projectId: string, packIds: readonly string[]): Promise<void>;
  /** Every project that has stored prefs. May include deleted projects. */
  listProjects(): Promise<string[]>;
}

export function createMemoryPackPrefsStore(
  initial: Record<string, readonly string[]> = {}
): PackPrefsStore {
  const prefs = new Map(Object.entries(initial).map(([id, packs]) => [id, [...packs]]));
  return {
    getEnabled: async (projectId) => [...(prefs.get(projectId) ?? [])],
    setEnabled: async (projectId, packIds) => {
      prefs.set(projectId, [...new Set(packIds)]);
    },
    listProjects: async () => [...prefs.keys()],
  };
}

interface StoredMemento<T> {
  readonly id: string;
  readonly default: T;
  readonly schema: {
    readonly currentVersion: string;
    parseJson(raw: string): T | null;
    serialize(value: T): string;
  };
}

interface SubjectRef {
  readonly kind: string;
  readonly key: string;
}

export type PackPrefsMementoClient = Pick<MementosRuntimeClient, 'memento'>;

/** Stores toggles in the mementos runtime: one memento per project, plus an app-level index. */
export function createMementoPackPrefsStore(
  getClient: () => Promise<PackPrefsMementoClient>,
  now: () => number = Date.now
): PackPrefsStore {
  let tail: Promise<unknown> = Promise.resolve();
  // Writes are read-modify-write on the index, so run them one at a time.
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };

  const modelKey = (def: StoredMemento<unknown>, subject: SubjectRef) => ({
    mementoId: def.id,
    kind: subject.kind,
    key: subject.key,
  });

  async function read<T>(def: StoredMemento<T>, subject: SubjectRef): Promise<T> {
    const client = await getClient();
    const snapshot = await client.memento
      .state(modelKey(def as StoredMemento<unknown>, subject), 'value')
      .snapshot();
    const row = snapshot.data;
    return (row ? def.schema.parseJson(row.data) : null) ?? def.default;
  }

  async function write<T>(def: StoredMemento<T>, subject: SubjectRef, value: T): Promise<void> {
    const client = await getClient();
    const result = await client.memento.mutate('save', {
      key: modelKey(def as StoredMemento<unknown>, subject),
      input: {
        version: def.schema.currentVersion,
        data: def.schema.serialize(value),
        updatedAt: now(),
      },
    });
    if (!result.success) throw new Error(result.error.message);
  }

  const app = appSubject({});
  const project = (projectId: string) => projectSubject({ projectId });

  return {
    async getEnabled(projectId) {
      return [...(await read(packsProjectPrefsMemento, project(projectId))).enabledPackIds];
    },
    setEnabled(projectId, packIds) {
      return serial(async () => {
        const enabledPackIds = [...new Set(packIds)];
        await write(packsProjectPrefsMemento, project(projectId), {
          version: '1',
          enabledPackIds,
        });
        const index = await read(packsPrefsIndexMemento, app);
        if (!index.projectIds.includes(projectId)) {
          await write(packsPrefsIndexMemento, app, {
            version: '1',
            projectIds: [...index.projectIds, projectId],
          });
        }
      });
    },
    async listProjects() {
      return [...(await read(packsPrefsIndexMemento, app)).projectIds];
    },
  };
}

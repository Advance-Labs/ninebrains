import { projectSubject } from '@core/features/projects/contributions/subject';
import { appSubject } from '@core/primitives/subjects/api';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { gatesPrefsIndexMemento, gatesProjectPrefsMemento } from '../../contributions/mementos';

export interface ProjectGatePrefs {
  /** Null means "use the app setting". */
  testingRigor: number | null;
  securityRigor: number | null;
  /** SEC-20: set by the user only. */
  testCommand: string | null;
}

export const EMPTY_PROJECT_PREFS: ProjectGatePrefs = {
  testingRigor: null,
  securityRigor: null,
  testCommand: null,
};

/**
 * Per-project gate prefs. A port, so storage can move to the Brain DB
 * (`project_prefs`) without touching callers. v0.1 stores them in mementos.
 */
export interface ProjectPrefsStore {
  get(projectId: string): Promise<ProjectGatePrefs>;
  set(projectId: string, prefs: ProjectGatePrefs): Promise<void>;
  /** Every project with stored prefs. May include deleted projects. */
  listProjects(): Promise<string[]>;
}

export function createMemoryProjectPrefsStore(
  initial: Record<string, Partial<ProjectGatePrefs>> = {}
): ProjectPrefsStore {
  const prefs = new Map(
    Object.entries(initial).map(([id, p]) => [id, { ...EMPTY_PROJECT_PREFS, ...p }])
  );
  return {
    get: async (projectId) => ({ ...(prefs.get(projectId) ?? EMPTY_PROJECT_PREFS) }),
    set: async (projectId, value) => {
      prefs.set(projectId, { ...value });
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

export type ProjectPrefsMementoClient = Pick<MementosRuntimeClient, 'memento'>;

/** Stores prefs in the mementos runtime: one memento per project, plus an app-level index. */
export function createMementoProjectPrefsStore(
  getClient: () => Promise<ProjectPrefsMementoClient>,
  now: () => number = Date.now
): ProjectPrefsStore {
  let tail: Promise<unknown> = Promise.resolve();
  // The index write is read-modify-write, so writes run one at a time.
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
    async get(projectId) {
      const { testingRigor, securityRigor, testCommand } = await read(
        gatesProjectPrefsMemento,
        project(projectId)
      );
      return { testingRigor, securityRigor, testCommand };
    },
    set(projectId, prefs) {
      return serial(async () => {
        await write(gatesProjectPrefsMemento, project(projectId), { version: '1', ...prefs });
        const index = await read(gatesPrefsIndexMemento, app);
        if (!index.projectIds.includes(projectId)) {
          await write(gatesPrefsIndexMemento, app, {
            version: '1',
            projectIds: [...index.projectIds, projectId],
          });
        }
      });
    },
    async listProjects() {
      return [...(await read(gatesPrefsIndexMemento, app)).projectIds];
    },
  };
}

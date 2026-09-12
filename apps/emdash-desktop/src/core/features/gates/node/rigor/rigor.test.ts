import { Brain, InMemoryBrainStore, type Identity } from '@ninebrains/brain-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GATES_SETTINGS, type GatesSettings } from '../../contributions/settings';
import {
  createMementoProjectPrefsStore,
  createMemoryProjectPrefsStore,
  type ProjectPrefsMementoClient,
} from './project-prefs';
import { RigorResolver, gateJobKindOf } from './rigor';

const BRAIN: Identity = { role: 'brain', brainId: 'main' };

async function resolver(
  settings: Partial<GatesSettings> = {},
  prefs: Parameters<typeof createMemoryProjectPrefsStore>[0] = {}
) {
  let current: GatesSettings = { ...DEFAULT_GATES_SETTINGS, ...settings };
  const listeners = new Set<() => void>();
  const rigor = new RigorResolver({
    settings: {
      get: async () => current,
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    prefs: createMemoryProjectPrefsStore(prefs),
  });
  await rigor.refresh();
  const change = (next: Partial<GatesSettings>) => {
    current = { ...current, ...next };
    for (const listener of listeners) listener();
  };
  return { rigor, change };
}

const floor = (rigor: RigorResolver, projectId: string, kind?: string) =>
  rigor.resolveGateFloor(projectId, 'work', kind ? { gates: [], kind } : null);

describe('rigor resolver', () => {
  it('defaults to 5/5: tests for code, tests + screenshot for ui', async () => {
    const { rigor } = await resolver();
    expect(floor(rigor, 'p1')).toEqual(['tests']);
    expect(floor(rigor, 'p1', 'ui')).toEqual(['tests', 'screenshot']);
    expect(floor(rigor, 'p1', 'research')).toEqual(['fact-check']);
    expect(floor(rigor, 'p1', 'docs')).toEqual([]);
  });

  it('a project override beats the app setting, per slider', async () => {
    const { rigor } = await resolver({}, { strict: { testingRigor: 7, securityRigor: null } });
    expect(rigor.rigorFor('strict')).toEqual({
      testing: 7,
      security: 5,
      source: { testing: 'project', security: 'app' },
    });
    expect(floor(rigor, 'strict', 'ui')).toEqual(['tests', 'screenshot', 'reviewer']);
    expect(floor(rigor, 'other', 'ui')).toEqual(['tests', 'screenshot']);
  });

  it('follows app-setting changes once watched', async () => {
    const { rigor, change } = await resolver();
    const stop = rigor.watch();
    change({ securityRigor: 8 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(floor(rigor, 'p1')).toEqual(['tests', 'security-review']);
    stop();
  });

  it('setProjectPrefs updates the cache and the store', async () => {
    const { rigor } = await resolver();
    await rigor.setProjectPrefs('p1', { testingRigor: 0, securityRigor: 0, testCommand: 'make' });
    expect(floor(rigor, 'p1', 'ui')).toEqual([]);
    expect(rigor.projectPrefs('p1').testCommand).toBe('make');
  });

  it('reads the gates-core kind from the spec and defaults to code', () => {
    expect(gateJobKindOf({ gates: [], kind: 'ui' })).toBe('ui');
    expect(gateJobKindOf({ gates: [], kind: 'video' })).toBe('code');
    expect(gateJobKindOf(null)).toBe('code');
  });
});

describe('SEC-08 caller cannot drop gates (app floor)', () => {
  it('a job asking for no gates at testing rigor 7 still gets the reviewer', async () => {
    const { rigor } = await resolver({ testingRigor: 7 });
    const brain = new Brain({
      store: new InMemoryBrainStore(),
      resolveGateFloor: rigor.resolveGateFloor,
    });
    const job = brain.createJob(BRAIN, { projectId: 'p1', title: 't', gateSpec: { gates: [] } });
    expect(job.gateSpec?.gates).toContain('reviewer');
    const ui = brain.createJob(BRAIN, {
      projectId: 'p1',
      title: 'ui',
      gateSpec: { gates: [], kind: 'ui' },
    });
    expect(ui.gateSpec?.gates).toEqual(['tests', 'screenshot', 'reviewer']);
  });
});

describe('memento project prefs store', () => {
  function fakeClient(): ProjectPrefsMementoClient {
    const rows = new Map<string, { data: string }>();
    const id = (key: { mementoId: string; kind: string; key: string }) =>
      `${key.mementoId}|${key.kind}|${key.key}`;
    return {
      memento: {
        state: (key: { mementoId: string; kind: string; key: string }) => ({
          snapshot: async () => ({ data: rows.get(id(key)) ?? null }),
        }),
        mutate: async (
          _name: string,
          {
            key,
            input,
          }: { key: { mementoId: string; kind: string; key: string }; input: { data: string } }
        ) => {
          rows.set(id(key), { data: input.data });
          return { success: true };
        },
      },
    } as unknown as ProjectPrefsMementoClient;
  }

  it('round-trips prefs and indexes the project', async () => {
    const client = fakeClient();
    const store = createMementoProjectPrefsStore(async () => client);
    expect(await store.get('p1')).toEqual({
      testingRigor: null,
      securityRigor: null,
      testCommand: null,
    });
    await store.set('p1', { testingRigor: 8, securityRigor: 2, testCommand: 'pnpm test' });
    await store.set('p1', { testingRigor: 9, securityRigor: 2, testCommand: 'pnpm test' });
    expect(await store.get('p1')).toEqual({
      testingRigor: 9,
      securityRigor: 2,
      testCommand: 'pnpm test',
    });
    expect(await store.listProjects()).toEqual(['p1']);
  });
});

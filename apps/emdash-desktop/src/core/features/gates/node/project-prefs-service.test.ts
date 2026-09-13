import { describe, expect, it } from 'vitest';
import { DEFAULT_GATES_SETTINGS } from '../contributions/settings';
import { createProjectPrefsService, unavailableProjectPrefsService } from './project-prefs-service';
import { createMemoryProjectPrefsStore } from './rigor/project-prefs';
import { RigorResolver } from './rigor/rigor';

async function setup(initial: Parameters<typeof createMemoryProjectPrefsStore>[0] = {}) {
  const store = createMemoryProjectPrefsStore(initial);
  const rigor = new RigorResolver({
    settings: { get: async () => DEFAULT_GATES_SETTINGS },
    prefs: store,
  });
  await rigor.refresh();
  return { rigor, store, service: createProjectPrefsService(rigor) };
}

describe('project prefs service (Settings → Gates test command)', () => {
  it('saves a trimmed command where the runner reads it, and persists it', async () => {
    const { rigor, store, service } = await setup();
    expect(await service.getProjectPrefs('p1')).toEqual({
      success: true,
      data: { projectId: 'p1', testCommand: null },
    });
    const saved = await service.setTestCommand({ projectId: 'p1', testCommand: '  pnpm test  ' });
    expect(saved).toEqual({ success: true, data: { projectId: 'p1', testCommand: 'pnpm test' } });
    expect(rigor.projectPrefs('p1').testCommand).toBe('pnpm test');
    expect((await store.get('p1')).testCommand).toBe('pnpm test');
  });

  it('keeps the project rigor overrides when the command changes', async () => {
    const { rigor, service } = await setup({ p1: { testingRigor: 7, securityRigor: 2 } });
    await service.setTestCommand({ projectId: 'p1', testCommand: 'make test' });
    expect(rigor.projectPrefs('p1')).toEqual({
      testingRigor: 7,
      securityRigor: 2,
      testCommand: 'make test',
    });
  });

  it('clears the command on empty input, so code jobs block again', async () => {
    const { rigor, service } = await setup({ p1: { testCommand: 'pnpm test' } });
    for (const testCommand of ['   ', null]) {
      await service.setTestCommand({ projectId: 'p1', testCommand });
      expect(rigor.projectPrefs('p1').testCommand).toBeNull();
    }
  });

  it('refuses a multi-line or oversized command and stores nothing', async () => {
    const { rigor, service } = await setup();
    for (const testCommand of ['pnpm test\nrm -rf ~', 'x'.repeat(501)]) {
      expect(await service.setTestCommand({ projectId: 'p1', testCommand })).toMatchObject({
        success: false,
        error: { type: 'refused' },
      });
    }
    expect(rigor.projectPrefs('p1').testCommand).toBeNull();
  });

  it('reports unavailable before boot wiring passes the real service', async () => {
    expect(await unavailableProjectPrefsService.getProjectPrefs('p1')).toMatchObject({
      success: false,
      error: { type: 'unavailable' },
    });
  });
});

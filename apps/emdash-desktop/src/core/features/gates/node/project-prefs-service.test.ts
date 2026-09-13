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
      data: {
        projectId: 'p1',
        testCommand: null,
        rigorLevel: null,
        allowNetwork: false,
        allowUnsandboxed: false,
      },
    });
    const saved = await service.setTestCommand({ projectId: 'p1', testCommand: '  pnpm test  ' });
    expect(saved).toEqual({
      success: true,
      data: {
        projectId: 'p1',
        testCommand: 'pnpm test',
        rigorLevel: null,
        allowNetwork: false,
        allowUnsandboxed: false,
      },
    });
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
      allowNetwork: false,
      allowUnsandboxed: false,
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

  describe('setProjectSettings (rigor override, tests-gate sandbox opt-outs)', () => {
    it('defaults allowNetwork and allowUnsandboxed to false, and rigor to the app setting', async () => {
      const { service } = await setup();
      expect(await service.getProjectPrefs('p1')).toMatchObject({
        success: true,
        data: { rigorLevel: null, allowNetwork: false, allowUnsandboxed: false },
      });
    });

    it('sets the rigor override and the sandbox opt-outs, and feeds the gate floor', async () => {
      const { rigor, service } = await setup();
      const saved = await service.setProjectSettings({
        projectId: 'p1',
        rigorLevel: 8,
        allowNetwork: true,
        allowUnsandboxed: true,
      });
      expect(saved).toEqual({
        success: true,
        data: {
          projectId: 'p1',
          testCommand: null,
          rigorLevel: 8,
          allowNetwork: true,
          allowUnsandboxed: true,
        },
      });
      // Both sliders move together: rigorFor and testsGateSettingsFor read the same prefs.
      expect(rigor.rigorFor('p1')).toMatchObject({ testing: 8, security: 8 });
      expect(rigor.testsGateSettingsFor('p1')).toEqual({
        allowNetwork: true,
        allowUnsandboxed: true,
      });
    });

    it('clears the rigor override back to the app default with null', async () => {
      const { rigor, service } = await setup();
      await service.setProjectSettings({
        projectId: 'p1',
        rigorLevel: 8,
        allowNetwork: false,
        allowUnsandboxed: false,
      });
      await service.setProjectSettings({
        projectId: 'p1',
        rigorLevel: null,
        allowNetwork: false,
        allowUnsandboxed: false,
      });
      expect(rigor.rigorFor('p1').source).toEqual({ testing: 'app', security: 'app' });
    });

    it('keeps the saved test command when settings change', async () => {
      const { rigor, service } = await setup({ p1: { testCommand: 'pnpm test' } });
      await service.setProjectSettings({
        projectId: 'p1',
        rigorLevel: 3,
        allowNetwork: true,
        allowUnsandboxed: false,
      });
      expect(rigor.projectPrefs('p1').testCommand).toBe('pnpm test');
    });

    it('refuses an out-of-range rigor level and stores nothing', async () => {
      const { rigor, service } = await setup();
      for (const rigorLevel of [-1, 11, 4.5]) {
        expect(
          await service.setProjectSettings({
            projectId: 'p1',
            rigorLevel,
            allowNetwork: false,
            allowUnsandboxed: false,
          })
        ).toMatchObject({ success: false, error: { type: 'refused' } });
      }
      expect(rigor.projectPrefs('p1')).toMatchObject({ testingRigor: null, securityRigor: null });
    });

    it('reports unavailable before boot wiring passes the real service', async () => {
      expect(
        await unavailableProjectPrefsService.setProjectSettings({
          projectId: 'p1',
          rigorLevel: null,
          allowNetwork: false,
          allowUnsandboxed: false,
        })
      ).toMatchObject({ success: false, error: { type: 'unavailable' } });
    });
  });

  describe('SEC-08: agent identities cannot reach this service', () => {
    it('has no counterpart in the Brain protocol op vocabulary', async () => {
      // The gates project-prefs contract is registered only as a renderer wire-rpc domain
      // (manifests/shared/domain-contracts.ts, manifests/node/controllers.ts). Agents and Brain
      // sessions act only through brain-core's BrainOp surface, which has no op that can reach
      // getProjectPrefs / setTestCommand / setProjectSettings — a lane or Brain token can only
      // ever *ask* over LANE_OPS/BRAIN_OPS (brain-core/src/protocol/ops.ts), never touch gate
      // settings. This test pins that vocabulary so an op cannot be added there silently.
      const { BRAIN_OPS, LANE_OPS, SESSION_OPS } = await import('@ninebrains/brain-core');
      const allOps = new Set<string>([...BRAIN_OPS, ...LANE_OPS, ...SESSION_OPS]);
      for (const forbidden of ['setProjectSettings', 'setTestCommand', 'getProjectPrefs']) {
        expect(allOps.has(forbidden)).toBe(false);
      }
    });
  });
});

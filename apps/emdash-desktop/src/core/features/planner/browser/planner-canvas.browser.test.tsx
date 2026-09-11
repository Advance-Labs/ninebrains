import '@emdash/ui/style.css';
import { err, ok } from '@emdash/shared';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import {
  plannerContract,
  plannerDomain,
  type CanvasDoc,
  type CompileOutcome,
  type PlannerJobState,
} from '../api';
import { PlannerCanvas } from './planner-canvas';
import {
  PLANNER_FIXTURE_CYCLE_DOC,
  PLANNER_FIXTURE_CYCLE_PATH,
  PLANNER_FIXTURE_DOC,
} from './testing/planner-fixture';
import { resetPlannerNodeStatesForTests } from './use-node-states';

// Live-model providers bind by endpoint id, derived from the mount path, so
// the fake provider is built against the domain-nested def (see the mcp slice test).
const nestedPlannerContract = defineContract({ [plannerDomain]: plannerContract })[plannerDomain];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

describe('planner canvas through the wire seam', () => {
  const states = cell<Record<string, PlannerJobState>>({});
  const compiled: unknown[] = [];
  let doc: CanvasDoc;
  let outcome: CompileOutcome;
  let handle: { dispose: () => Promise<void> };
  let host: HTMLDivElement;
  let root: Root;

  const node = (id: string) => host.querySelector<HTMLElement>(`[data-testid="planner-node-${id}"]`);

  async function renderCanvas() {
    await act(async () => {
      root.render(<PlannerCanvas projectId="p1" canvasId="c1" />);
    });
    await vi.waitFor(() => expect(node('design')).not.toBeNull());
  }

  beforeEach(() => {
    compiled.length = 0;
    states.set({});
    doc = PLANNER_FIXTURE_DOC;
    outcome = { created: 5, updated: 0, unchanged: 0, archived: 0 };
    handle = seedSliceWire(plannerDomain, plannerContract, {
      listCanvases: async () => ok([]),
      getCanvas: async () => ok({ doc, recovered: false }),
      saveCanvas: async () => ok({ updatedAt: 2 }),
      compile: async (input: unknown) => {
        compiled.push(input);
        return ok(outcome);
      },
      draftFromBrief: async () => err({ type: 'unavailable' as const, message: 'Drafting needs the Brain.' }),
      nodeStates: expose(nestedPlannerContract.nodeStates, { states }),
    });
    host = document.createElement('div');
    host.style.width = '1200px';
    host.style.height = '700px';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await resetPlannerNodeStatesForTests();
    await handle.dispose();
  });

  it('renders job, note and module nodes from the saved canvas', async () => {
    await renderCanvas();
    expect(node('design')?.textContent).toContain('Design the auth schema');
    expect(node('backend')?.textContent).toContain('Backend');
    expect(node('backend')?.textContent).toContain('2 jobs');
    expect(node('note')?.textContent).toContain('Magic links only');
    expect(host.querySelectorAll('.react-flow__edge')).toHaveLength(3);
  });

  it('colours nodes from the live job-state model', async () => {
    await renderCanvas();
    expect(node('design')?.dataset.state).toBe('uncompiled');
    act(() => {
      states.set({ design: 'done', ui: 'blocked' });
    });
    await vi.waitFor(() => expect(node('design')?.dataset.state).toBe('done'));
    expect(node('ui')?.dataset.state).toBe('blocked');
    expect(node('ui')?.textContent).toContain('Blocked');
  });

  it('Run plan calls compile for this canvas', async () => {
    await renderCanvas();
    const run = host.querySelector<HTMLButtonElement>('button[aria-label="Run plan"]');
    expect(run).not.toBeNull();
    await act(async () => run!.click());
    await vi.waitFor(() => expect(compiled).toEqual([{ projectId: 'p1', canvasId: 'c1' }]));
  });

  it('highlights the cycle path when compile rejects the plan', async () => {
    doc = PLANNER_FIXTURE_CYCLE_DOC;
    outcome = { created: 0, updated: 0, unchanged: 0, archived: 0, cycles: [PLANNER_FIXTURE_CYCLE_PATH] };
    await renderCanvas();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Run plan"]')!.click());
    await vi.waitFor(() => expect(node('review')?.dataset.inCycle).toBe('true'));
    expect(node('design')?.dataset.inCycle).toBe('true');
    expect(node('note')?.dataset.inCycle).toBeUndefined();
    expect(host.querySelectorAll('.react-flow__edge.planner-cycle').length).toBeGreaterThanOrEqual(3);
  });
});

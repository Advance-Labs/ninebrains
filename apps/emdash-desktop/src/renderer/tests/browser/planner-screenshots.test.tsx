import '@emdash/ui/style.css';
import { ok } from '@emdash/shared';
import { Toaster } from '@emdash/ui/react/primitives';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { page } from 'vitest/browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { plannerContract, plannerDomain, type CanvasDoc, type CompileOutcome } from '@core/features/planner/api';
import { PlannerCanvas } from '@core/features/planner/browser/planner-canvas';
import {
  PLANNER_FIXTURE_CYCLE_DOC,
  PLANNER_FIXTURE_CYCLE_PATH,
  PLANNER_FIXTURE_DOC,
  PLANNER_FIXTURE_STATES,
} from '@core/features/planner/browser/testing/planner-fixture';
import { resetPlannerNodeStatesForTests } from '@core/features/planner/browser/use-node-states';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';

// Renders the planner with the app's real CSS and writes the review screenshots
// to docs/screenshots. Opt-in, so ordinary runs never touch tracked files.
//
// The browser test project does not run the Tailwind plugin over imported CSS
// (index.css arrives uncompiled), so the renderer stylesheet is precompiled
// into the untracked __generated__/planner-tailwind.css first. See
// features/planner/README.md, "Screenshots", for the two commands.
import.meta.glob('./__generated__/planner-tailwind.css', { eager: true });

const SHOTS = '../../../../../../docs/screenshots';
const nested = defineContract({ [plannerDomain]: plannerContract })[plannerDomain];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

describe.skipIf(!import.meta.env.VITE_PLANNER_SCREENSHOTS)('planner screenshots', () => {
  let doc: CanvasDoc;
  let outcome: CompileOutcome;
  let handle: { dispose: () => Promise<void> };
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    doc = PLANNER_FIXTURE_DOC;
    outcome = { created: 5, updated: 0, unchanged: 0, archived: 0 };
    handle = seedSliceWire(plannerDomain, plannerContract, {
      listCanvases: async () => ok([]),
      getCanvas: async () => ok({ doc, recovered: false }),
      saveCanvas: async () => ok({ updatedAt: 2 }),
      compile: async () => ok(outcome),
      draftFromBrief: async () => ok({ nodes: [], edges: [] }),
      nodeStates: expose(nested.nodeStates, { states: cell(PLANNER_FIXTURE_STATES) }),
    });
    document.body.style.margin = '0';
    host = document.createElement('div');
    host.style.width = '100vw';
    host.style.height = '100vh';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await resetPlannerNodeStatesForTests();
    await handle.dispose();
  });

  async function show(theme: 'emlight' | 'emdark', width: number, height: number) {
    await page.viewport(width, height);
    document.documentElement.className = theme;
    await act(async () => {
      root.render(
        <ThemeProvider theme={theme} onThemeChange={vi.fn()}>
          <div className={`${theme} h-full bg-background text-foreground`}>
            <PlannerCanvas projectId="p1" canvasId="c1" />
            <Toaster />
          </div>
        </ThemeProvider>
      );
    });
    await vi.waitFor(() => {
      if (!host.querySelector('[data-testid="planner-node-review"]')) throw new Error('not rendered');
    });
    await vi.waitFor(() => {
      if (!host.querySelector('[data-state="done"]')) throw new Error('no live state yet');
    });
    // Let fitView and the entrance transitions settle.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  async function runPlan() {
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Run plan"]')!.click());
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  it('light, 1440', async () => {
    await show('emlight', 1440, 900);
    await page.screenshot({ path: `${SHOTS}/planner-1440.png` });
  });

  it('dark, 1440, after Run plan', async () => {
    await show('emdark', 1440, 900);
    await runPlan();
    await page.screenshot({ path: `${SHOTS}/planner-dark-1440.png` });
  });

  it('cycle error, 1440', async () => {
    doc = PLANNER_FIXTURE_CYCLE_DOC;
    outcome = { created: 0, updated: 0, unchanged: 0, archived: 0, cycles: [PLANNER_FIXTURE_CYCLE_PATH] };
    await show('emlight', 1440, 900);
    await runPlan();
    await page.screenshot({ path: `${SHOTS}/planner-cycle-1440.png` });
  });

  it('light, 390', async () => {
    await show('emlight', 390, 844);
    await page.screenshot({ path: `${SHOTS}/planner-390.png` });
  });
});

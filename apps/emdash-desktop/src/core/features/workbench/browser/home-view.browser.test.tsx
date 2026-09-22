import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { lanesViewDef } from '@core/features/lanes/contributions/views';
import { plannerViewDef } from '@core/features/planner/contributions/views';
import { HomeMainPanel } from './home-view';

// The home panel ends up grouped on the first project; the navigation hook
// carries the real view defs, so tiles are asserted against navigate targets.

const navigateSpy = vi.hoisted(() => vi.fn());

const projectState = vi.hoisted(() => ({ size: 0 }));

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: navigateSpy }),
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    projects: projectState.size > 0 ? new Map([['p1', { id: 'p1', name: 'Repo' }]]) : new Map(),
  }),
}));

vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => vi.fn(),
}));

vi.mock('@core/primitives/theme/browser', () => ({
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('home view lanes and planner discovery', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    navigateSpy.mockReset();
    projectState.size = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const render = async () => {
    await act(async () => root.render(<HomeMainPanel />));
  };

  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it('renders Open Lanes and Open Planner tiles', async () => {
    projectState.size = 1;
    await render();
    expect(button('Open Lanes')).toBeTruthy();
    expect(button('Open Planner')).toBeTruthy();
  });

  it('navigates to the lanes view', async () => {
    projectState.size = 1;
    await render();
    button('Open Lanes')?.click();
    expect(navigateSpy).toHaveBeenCalledWith(lanesViewDef({}));
  });

  it('navigates to the planner view for the first project', async () => {
    projectState.size = 1;
    await render();
    button('Open Planner')?.click();
    expect(navigateSpy).toHaveBeenCalledWith(plannerViewDef({ projectId: 'p1' }));
  });

  it('disables the planner tile when no project exists yet', async () => {
    await render();
    const planner = button('Open Planner');
    expect(planner?.disabled).toBe(true);
    planner?.click();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('greets first-run users without a project', async () => {
    await render();
    expect(host.querySelector('[data-testid="home-first-run-hint"]')).toBeTruthy();
  });

  it('hides the first-run hint once a project exists', async () => {
    projectState.size = 1;
    await render();
    expect(host.querySelector('[data-testid="home-first-run-hint"]')).toBeNull();
  });
});

import { observable, runInAction } from 'mobx';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleFocusRegion } from '@core/features/workbench/api/browser/focus-regions';
import { SidebarVirtualList } from './sidebar-virtual-list';

const navigateSpy = vi.hoisted(() => vi.fn());

type Row =
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string };

const store = vi.hoisted(() => ({ current: null as unknown }));

function createStore() {
  const tasks: Record<string, string[]> = { a: ['t1', 't2'], b: [] };
  const state = observable({ expanded: new Set(['a']) });
  return {
    get expandedProjectIds() {
      return state.expanded as ReadonlySet<string>;
    },
    get sidebarRows(): Row[] {
      const rows: Row[] = [];
      for (const projectId of ['a', 'b']) {
        rows.push({ kind: 'project', projectId });
        if (state.expanded.has(projectId)) {
          for (const taskId of tasks[projectId] ?? [])
            rows.push({ kind: 'task', projectId, taskId });
        }
      }
      return rows;
    },
    toggleProjectExpanded: (projectId: string) =>
      runInAction(() => {
        if (state.expanded.has(projectId)) state.expanded.delete(projectId);
        else state.expanded.add(projectId);
      }),
  };
}

vi.mock('@core/features/workbench/contributions/browser/app-stores', () => ({
  getSidebarStore: () => store.current,
}));
vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  getTaskStore: () => undefined,
}));
vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: navigateSpy }),
  useWorkspaceSlots: () => ({ currentView: 'home' }),
  useViewParams: () => undefined,
}));
vi.mock('./project-item', () => ({
  SidebarProjectItem: ({ projectId }: { projectId: string }) => <span>project {projectId}</span>,
}));
vi.mock('./task-item', () => ({
  SidebarTaskItem: ({ taskId }: { taskId: string }) => <span>task {taskId}</span>,
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('sidebar keyboard navigation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    navigateSpy.mockReset();
    store.current = createStore();
    host = document.createElement('div');
    host.style.cssText = 'height: 400px; display: flex; flex-direction: column;';
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<SidebarVirtualList />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const tree = () => host.querySelector<HTMLElement>('[role="tree"]')!;
  const press = async (key: string, target: Element = tree()) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
  };
  const activeRowText = () => {
    const id = tree().getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent : null;
  };

  it('exposes tree semantics', () => {
    expect(tree().tabIndex).toBe(0);
    const items = host.querySelectorAll('[role="treeitem"]');
    expect(items).toHaveLength(4);
    expect(items[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(items[3]?.getAttribute('aria-expanded')).toBe('false');
    expect(items[1]?.getAttribute('aria-level')).toBe('2');
    expect(items[1]?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('moves with arrows and j/k, and Home/End jump', async () => {
    await act(async () => tree().focus());
    expect(activeRowText()).toBe('project a');
    await press('ArrowDown');
    expect(activeRowText()).toBe('task t1');
    await press('j');
    expect(activeRowText()).toBe('task t2');
    await press('k');
    expect(activeRowText()).toBe('task t1');
    await press('End');
    expect(activeRowText()).toBe('project b');
    await press('Home');
    expect(activeRowText()).toBe('project a');
  });

  it('collapses, expands and walks to the parent with Left and Right', async () => {
    await act(async () => tree().focus());
    await press('ArrowLeft');
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    await press('ArrowRight');
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(4);
    await press('ArrowRight');
    expect(activeRowText()).toBe('task t1');
    await press('ArrowLeft');
    expect(activeRowText()).toBe('project a');
  });

  it('opens the focused task with Enter and Space', async () => {
    await act(async () => tree().focus());
    await press('j');
    await press('Enter');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]?.[0]).toMatchObject({
      params: { projectId: 'a', taskId: 't1' },
    });
    await press(' ');
    expect(navigateSpy).toHaveBeenCalledTimes(2);
  });

  it('leaves plain-letter keys alone while the user is typing in an input', async () => {
    const input = document.createElement('input');
    host.appendChild(input);
    await act(async () => tree().focus());
    await act(async () => input.focus());
    const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    await act(async () => {
      input.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(activeRowText()).toBeNull();
  });

  it('cycles regions with F6 order, skipping regions that are not shown', async () => {
    const region = (name: string, hidden = false) => {
      const el = document.createElement('div');
      el.setAttribute('data-focus-region', name);
      el.tabIndex = -1;
      el.style.display = hidden ? 'none' : 'block';
      el.textContent = name;
      document.body.appendChild(el);
      return el;
    };
    const main = region('main');
    region('bottom', true);
    const right = region('right');
    try {
      await act(async () => tree().focus());
      cycleFocusRegion(1);
      expect(document.activeElement).toBe(main);
      cycleFocusRegion(1);
      expect(document.activeElement).toBe(right);
      cycleFocusRegion(1);
      expect(document.activeElement).toBe(tree());
      cycleFocusRegion(-1);
      expect(document.activeElement).toBe(right);
    } finally {
      main.remove();
      right.remove();
      document.querySelector('[data-focus-region="bottom"]')?.remove();
    }
  });
});

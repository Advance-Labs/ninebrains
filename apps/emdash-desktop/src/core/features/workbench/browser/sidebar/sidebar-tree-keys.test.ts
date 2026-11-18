import { describe, expect, it } from 'vitest';
import type { SidebarRow } from './sidebar-store';
import { treeKeyAction, treeRowMetas } from './sidebar-tree-keys';

const rows: SidebarRow[] = [
  { kind: 'project', projectId: 'a' },
  { kind: 'task', projectId: 'a', taskId: 't1' },
  { kind: 'task', projectId: 'a', taskId: 't2' },
  { kind: 'project', projectId: 'b' },
];
const expanded = (id: string) => id === 'a';

describe('treeKeyAction', () => {
  it('moves with arrows and j/k, clamping at the ends', () => {
    expect(treeKeyAction(rows, 0, 'ArrowDown', expanded)).toEqual({ type: 'focus', index: 1 });
    expect(treeKeyAction(rows, 0, 'j', expanded)).toEqual({ type: 'focus', index: 1 });
    expect(treeKeyAction(rows, 0, 'k', expanded)).toEqual({ type: 'focus', index: 0 });
    expect(treeKeyAction(rows, 3, 'ArrowDown', expanded)).toEqual({ type: 'focus', index: 3 });
    expect(treeKeyAction(rows, 2, 'ArrowUp', expanded)).toEqual({ type: 'focus', index: 1 });
  });

  it('jumps with Home and End', () => {
    expect(treeKeyAction(rows, 2, 'Home', expanded)).toEqual({ type: 'focus', index: 0 });
    expect(treeKeyAction(rows, 0, 'End', expanded)).toEqual({ type: 'focus', index: 3 });
  });

  it('expands, collapses and walks to the parent or first child', () => {
    expect(treeKeyAction(rows, 3, 'ArrowRight', expanded)).toEqual({
      type: 'expand',
      projectId: 'b',
    });
    expect(treeKeyAction(rows, 0, 'ArrowRight', expanded)).toEqual({ type: 'focus', index: 1 });
    expect(treeKeyAction(rows, 0, 'ArrowLeft', expanded)).toEqual({
      type: 'collapse',
      projectId: 'a',
    });
    expect(treeKeyAction(rows, 3, 'ArrowLeft', expanded)).toBeNull();
    expect(treeKeyAction(rows, 2, 'ArrowLeft', expanded)).toEqual({ type: 'focus', index: 0 });
    expect(treeKeyAction(rows, 2, 'ArrowRight', expanded)).toBeNull();
  });

  it('opens on Enter, activates on Space, ignores other keys and empty trees', () => {
    expect(treeKeyAction(rows, 1, 'Enter', expanded)).toEqual({ type: 'open', index: 1 });
    expect(treeKeyAction(rows, 1, ' ', expanded)).toEqual({ type: 'activate', index: 1 });
    expect(treeKeyAction(rows, 1, 'x', expanded)).toBeNull();
    expect(treeKeyAction([], 0, 'j', expanded)).toBeNull();
  });
});

describe('treeRowMetas', () => {
  it('numbers projects and each project tasks', () => {
    expect(treeRowMetas(rows)).toEqual([
      { level: 1, posInSet: 1, setSize: 2 },
      { level: 2, posInSet: 1, setSize: 2 },
      { level: 2, posInSet: 2, setSize: 2 },
      { level: 1, posInSet: 2, setSize: 2 },
    ]);
  });
});

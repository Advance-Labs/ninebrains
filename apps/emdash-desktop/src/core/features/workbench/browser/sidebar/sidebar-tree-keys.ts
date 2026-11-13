import type { SidebarRow } from './sidebar-store';

export type TreeKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'expand'; projectId: string }
  | { type: 'collapse'; projectId: string }
  | { type: 'open'; index: number }
  | { type: 'activate'; index: number };

/**
 * Maps a key press on the sidebar tree to what should happen next. Pure: the caller owns the
 * focused index and applies the action. `j`/`k` mirror ArrowDown/ArrowUp. Enter opens the row;
 * Space opens a task but toggles a project.
 */
export function treeKeyAction(
  rows: readonly SidebarRow[],
  index: number,
  key: string,
  isExpanded: (projectId: string) => boolean
): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const last = rows.length - 1;
  const current = Math.min(Math.max(index, 0), last);
  const row = rows[current]!;

  switch (key) {
    case 'ArrowDown':
    case 'j':
      return { type: 'focus', index: Math.min(current + 1, last) };
    case 'ArrowUp':
    case 'k':
      return { type: 'focus', index: Math.max(current - 1, 0) };
    case 'Home':
      return { type: 'focus', index: 0 };
    case 'End':
      return { type: 'focus', index: last };
    case 'ArrowRight': {
      if (row.kind !== 'project') return null;
      if (!isExpanded(row.projectId)) return { type: 'expand', projectId: row.projectId };
      const next = rows[current + 1];
      return next?.kind === 'task' && next.projectId === row.projectId
        ? { type: 'focus', index: current + 1 }
        : null;
    }
    case 'ArrowLeft': {
      if (row.kind === 'project') {
        return isExpanded(row.projectId) ? { type: 'collapse', projectId: row.projectId } : null;
      }
      const parent = rows.findIndex((r) => r.kind === 'project' && r.projectId === row.projectId);
      return parent >= 0 ? { type: 'focus', index: parent } : null;
    }
    case 'Enter':
      return { type: 'open', index: current };
    case ' ':
      return { type: 'activate', index: current };
    default:
      return null;
  }
}

export type TreeRowMeta = { level: 1 | 2; posInSet: number; setSize: number };

/** ARIA tree metadata for each row; needed because a virtualized tree never renders siblings. */
export function treeRowMetas(rows: readonly SidebarRow[]): TreeRowMeta[] {
  const projectCount = rows.filter((r) => r.kind === 'project').length;
  const taskCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === 'task') taskCounts.set(r.projectId, (taskCounts.get(r.projectId) ?? 0) + 1);
  }
  const seenTasks = new Map<string, number>();
  let projectsSeen = 0;
  return rows.map((r) => {
    if (r.kind === 'project') {
      projectsSeen += 1;
      return { level: 1, posInSet: projectsSeen, setSize: projectCount };
    }
    const n = (seenTasks.get(r.projectId) ?? 0) + 1;
    seenTasks.set(r.projectId, n);
    return { level: 2, posInSet: n, setSize: taskCounts.get(r.projectId) ?? n };
  });
}

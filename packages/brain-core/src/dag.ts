import type { JobId } from './types';

export interface EdgeLike {
  from: string;
  to: string;
}

/**
 * Finds a dependency cycle, or returns null. The returned path starts and
 * ends on the same node, e.g. `['a', 'b', 'c', 'a']`. Iterative DFS so deep
 * plans cannot overflow the stack.
 */
export function findCycle(nodes: Iterable<string>, edges: readonly EdgeLike[]): string[] | null {
  const out = new Map<string, string[]>();
  for (const node of nodes) out.set(node, []);
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    if (!out.has(edge.to)) out.set(edge.to, []);
    out.get(edge.from)!.push(edge.to);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of out.keys()) color.set(node, WHITE);

  for (const root of out.keys()) {
    if (color.get(root) !== WHITE) continue;
    const stack: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];
    const path: string[] = [root];
    color.set(root, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = out.get(frame.node)!;
      if (frame.next >= children.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const child = children[frame.next++]!;
      const c = color.get(child);
      if (c === GREY) {
        return [...path.slice(path.indexOf(child)), child];
      }
      if (c === WHITE) {
        color.set(child, GREY);
        stack.push({ node: child, next: 0 });
        path.push(child);
      }
    }
  }
  return null;
}

/**
 * The cycle that adding `from -> to` would close, or null. A cycle exists
 * when `from` is already reachable from `to`.
 */
export function cycleIfAdded(edges: readonly EdgeLike[], from: string, to: string): string[] | null {
  if (from === to) return [from, from];
  const found = pathBetween(edges, to, from);
  return found ? [from, ...found] : null;
}

/** A path `start -> ... -> goal` following edge direction, or null. */
export function pathBetween(edges: readonly EdgeLike[], start: string, goal: string): string[] | null {
  const out = adjacency(edges, 'from');
  const parent = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === goal) {
      const path: string[] = [];
      for (let at: string | null = node; at !== null; at = parent.get(at) ?? null) path.unshift(at);
      return path;
    }
    for (const next of out.get(node) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}

/** Every job `jobId` transitively depends on (its dependency chain). */
export function ancestors(edges: readonly EdgeLike[], jobId: JobId): Set<JobId> {
  const inbound = adjacency(edges, 'to');
  const seen = new Set<JobId>();
  const queue = [...(inbound.get(jobId) ?? [])];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...(inbound.get(node) ?? []));
  }
  return seen;
}

function adjacency(edges: readonly EdgeLike[], key: 'from' | 'to'): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const k = edge[key];
    const v = key === 'from' ? edge.to : edge.from;
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  }
  return map;
}

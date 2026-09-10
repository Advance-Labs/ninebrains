import type { CanvasDoc, CanvasNode, JobNode } from './schema';

export interface FlatPlan {
  /** Accepted job nodes, in document order. */
  jobs: JobNode[];
  /** `to` depends on `from`, both job node ids, deduplicated. */
  edges: Array<{ from: string; to: string }>;
  /** `from>to` -> the canvas edge ids that produced that dependency. */
  edgeOrigins: Map<string, string[]>;
}

export const pairKey = (from: string, to: string): string => `${from}>${to}`;

/**
 * Reduces a canvas to the job DAG the Brain compiles:
 * - notes and modules are not jobs; proposed (unaccepted) nodes and edges are skipped;
 * - an edge that touches a module stands for every accepted job inside it,
 *   at any depth, so "module A -> job X" means every job in A precedes X.
 */
export function flattenCanvas(doc: Pick<CanvasDoc, 'nodes' | 'edges'>): FlatPlan {
  const byId = new Map<string, CanvasNode>(doc.nodes.map((node) => [node.id, node]));
  const children = new Map<string, CanvasNode[]>();
  for (const node of doc.nodes) {
    if (node.parentId === undefined) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }

  const leaves = (id: string, seen = new Set<string>()): string[] => {
    const node = byId.get(id);
    if (!node || node.proposed || seen.has(id)) return [];
    seen.add(id);
    if (node.type === 'job') return [id];
    if (node.type === 'note') return [];
    return (children.get(id) ?? []).flatMap((child) => leaves(child.id, seen));
  };

  const jobs = doc.nodes.filter((node): node is JobNode => node.type === 'job' && !node.proposed);
  const edges: FlatPlan['edges'] = [];
  const edgeOrigins = new Map<string, string[]>();
  for (const edge of doc.edges) {
    if (edge.proposed) continue;
    for (const from of leaves(edge.source)) {
      for (const to of leaves(edge.target)) {
        if (from === to) continue;
        const key = pairKey(from, to);
        const origins = edgeOrigins.get(key);
        if (origins) {
          origins.push(edge.id);
          continue;
        }
        edgeOrigins.set(key, [edge.id]);
        edges.push({ from, to });
      }
    }
  }
  return { jobs, edges, edgeOrigins };
}

/** Canvas edge ids that carry a dependency on the cycle path `[a, b, c, a]`. */
export function cycleEdgeIds(plan: FlatPlan, path: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i + 1 < path.length; i++) {
    for (const id of plan.edgeOrigins.get(pairKey(path[i]!, path[i + 1]!)) ?? []) ids.add(id);
  }
  return ids;
}

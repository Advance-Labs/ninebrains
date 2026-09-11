import type { Edge, Node } from '@xyflow/react';
import type {
  CanvasDoc,
  CanvasEdge,
  CanvasNode,
  DraftProposal,
  PlannerJobState,
} from '@core/features/planner/api';

/**
 * Pure document operations for the planner canvas. The document is the
 * source of truth; xyflow nodes and edges are derived from it per render.
 * `scope` is the module being drilled into, or undefined for the root.
 */

export type PlannerNodeType = CanvasNode['type'];

export type PlannerNodeData = {
  canvasNode: CanvasNode;
  state?: PlannerJobState;
  inCycle: boolean;
  /** Jobs inside a module, at any depth. */
  jobCount: number;
};

export type PlannerFlowNode = Node<PlannerNodeData, PlannerNodeType>;

export interface ClipboardPayload {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function newPlannerId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function childrenIndex(doc: Pick<CanvasDoc, 'nodes'>): Map<string, CanvasNode[]> {
  const index = new Map<string, CanvasNode[]>();
  for (const node of doc.nodes) {
    if (node.parentId === undefined) continue;
    const list = index.get(node.parentId) ?? [];
    list.push(node);
    index.set(node.parentId, list);
  }
  return index;
}

/** `id` and every node nested inside it. */
export function withDescendants(doc: Pick<CanvasDoc, 'nodes'>, ids: Iterable<string>): Set<string> {
  const index = childrenIndex(doc);
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of index.get(id) ?? []) visit(child.id);
  };
  for (const id of ids) visit(id);
  return out;
}

/** Nodes shown for a scope: everything at the root, or the module's descendants when drilled in. */
export function visibleNodeIds(doc: CanvasDoc, scope: string | undefined): Set<string> {
  if (scope === undefined) return new Set(doc.nodes.map((node) => node.id));
  const ids = withDescendants(doc, [scope]);
  ids.delete(scope);
  return ids;
}

function depthOf(byId: Map<string, CanvasNode>, node: CanvasNode): number {
  let depth = 0;
  let cursor = node.parentId;
  while (cursor !== undefined && depth < 64) {
    depth++;
    cursor = byId.get(cursor)?.parentId;
  }
  return depth;
}

export function toFlowNodes(
  doc: CanvasDoc,
  scope: string | undefined,
  options: {
    states: Record<string, PlannerJobState>;
    cycleNodes: ReadonlySet<string>;
    selected: ReadonlySet<string>;
  }
): PlannerFlowNode[] {
  const visible = visibleNodeIds(doc, scope);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const index = childrenIndex(doc);
  const jobCount = (id: string): number =>
    (index.get(id) ?? []).reduce(
      (sum, child) =>
        sum + (child.type === 'job' ? 1 : child.type === 'module' ? jobCount(child.id) : 0),
      0
    );
  // xyflow needs parents before their children.
  return doc.nodes
    .filter((node) => visible.has(node.id))
    .sort((a, b) => depthOf(byId, a) - depthOf(byId, b))
    .map((node) => {
      const parentId = node.parentId === scope ? undefined : node.parentId;
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        ...(parentId !== undefined ? { parentId, extent: 'parent' as const } : {}),
        ...(node.type === 'module'
          ? { style: { width: node.size.width, height: node.size.height }, zIndex: -1 }
          : {}),
        selected: options.selected.has(node.id),
        className: node.proposed ? 'planner-proposed' : undefined,
        data: {
          canvasNode: node,
          state: options.states[node.id],
          inCycle: options.cycleNodes.has(node.id),
          jobCount: node.type === 'module' ? jobCount(node.id) : 0,
        },
      };
    });
}

export function toFlowEdges(
  doc: CanvasDoc,
  scope: string | undefined,
  options: { cycleEdges: ReadonlySet<string>; selected: ReadonlySet<string> }
): Edge[] {
  const visible = visibleNodeIds(doc, scope);
  return doc.edges
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      selected: options.selected.has(edge.id),
      className: [
        edge.proposed ? 'planner-proposed' : '',
        options.cycleEdges.has(edge.id) ? 'planner-cycle' : '',
      ]
        .join(' ')
        .trim(),
    }));
}

/** Root-to-scope chain of modules, for breadcrumbs. */
export function breadcrumbPath(
  doc: CanvasDoc,
  scope: string | undefined
): Array<{ id: string; title: string }> {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const path: Array<{ id: string; title: string }> = [];
  let cursor = scope;
  while (cursor !== undefined && path.length < 64) {
    const node = byId.get(cursor);
    if (node?.type !== 'module') break;
    path.unshift({ id: node.id, title: node.title });
    cursor = node.parentId;
  }
  return path;
}

export function updateNode(
  doc: CanvasDoc,
  id: string,
  patch: (node: CanvasNode) => CanvasNode
): CanvasDoc {
  return { ...doc, nodes: doc.nodes.map((node) => (node.id === id ? patch(node) : node)) };
}

export function moveNodes(
  doc: CanvasDoc,
  positions: ReadonlyMap<string, { x: number; y: number }>
): CanvasDoc {
  if (positions.size === 0) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position: { x: position.x, y: position.y } } : node;
    }),
  };
}

export function resizeModule(
  doc: CanvasDoc,
  id: string,
  size: { width: number; height: number }
): CanvasDoc {
  return updateNode(doc, id, (node) =>
    node.type === 'module'
      ? { ...node, size: { width: Math.max(120, size.width), height: Math.max(80, size.height) } }
      : node
  );
}

/** Removes nodes (modules take their contents with them) and edges, plus any edge left dangling. */
export function removeElements(
  doc: CanvasDoc,
  nodeIds: Iterable<string>,
  edgeIds: Iterable<string> = []
): CanvasDoc {
  const goneNodes = withDescendants(doc, nodeIds);
  const goneEdges = new Set(edgeIds);
  return {
    ...doc,
    nodes: doc.nodes.filter((node) => !goneNodes.has(node.id)),
    edges: doc.edges.filter(
      (edge) =>
        !goneEdges.has(edge.id) && !goneNodes.has(edge.source) && !goneNodes.has(edge.target)
    ),
  };
}

export function addNodes(doc: CanvasDoc, nodes: CanvasNode[]): CanvasDoc {
  return { ...doc, nodes: [...doc.nodes, ...nodes] };
}

/** Adds `source -> target` unless it would duplicate an edge or loop a node onto itself. */
export function connect(
  doc: CanvasDoc,
  source: string,
  target: string,
  id = newPlannerId('e')
): CanvasDoc {
  if (source === target) return doc;
  if (doc.edges.some((edge) => edge.source === source && edge.target === target)) return doc;
  return { ...doc, edges: [...doc.edges, { id, source, target }] };
}

export function copySelection(doc: CanvasDoc, nodeIds: Iterable<string>): ClipboardPayload {
  const ids = withDescendants(doc, nodeIds);
  return {
    nodes: doc.nodes.filter((node) => ids.has(node.id)),
    edges: doc.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

/** Pastes with fresh ids. Top-level pasted nodes land in `scope`, offset so they don't cover the originals. */
export function pasteClipboard(
  doc: CanvasDoc,
  payload: ClipboardPayload,
  scope: string | undefined,
  offset = 40
): { doc: CanvasDoc; pastedIds: string[] } {
  const remap = new Map(
    payload.nodes.map((node) => [node.id, newPlannerId(node.type === 'module' ? 'm' : 'n')])
  );
  const nodes = payload.nodes.map((node): CanvasNode => {
    const nested = node.parentId !== undefined && remap.has(node.parentId);
    return {
      ...node,
      id: remap.get(node.id)!,
      parentId: nested ? remap.get(node.parentId!) : scope,
      position: nested
        ? node.position
        : { x: node.position.x + offset, y: node.position.y + offset },
    };
  });
  const edges = payload.edges.map((edge) => ({
    ...edge,
    id: newPlannerId('e'),
    source: remap.get(edge.source)!,
    target: remap.get(edge.target)!,
  }));
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] },
    pastedIds: [...remap.values()],
  };
}

/** Places a draft beside the existing canvas, in `scope`, as proposed nodes and edges. */
export function mergeProposal(
  doc: CanvasDoc,
  proposal: DraftProposal,
  scope: string | undefined
): CanvasDoc {
  const known = new Set(doc.nodes.map((node) => node.id));
  const nodes = proposal.nodes
    .filter((node) => !known.has(node.id))
    .map((node) => ({ ...node, proposed: true, parentId: node.parentId ?? scope }));
  const edges = proposal.edges.map((edge) => ({ ...edge, proposed: true }));
  return { ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] };
}

export function hasProposals(doc: CanvasDoc): boolean {
  return doc.nodes.some((node) => node.proposed) || doc.edges.some((edge) => edge.proposed);
}

export function acceptProposals(doc: CanvasDoc): CanvasDoc {
  const clear = <T extends { proposed?: boolean }>({ proposed: _p, ...rest }: T) => rest as T;
  return { ...doc, nodes: doc.nodes.map(clear), edges: doc.edges.map(clear) };
}

export function rejectProposals(doc: CanvasDoc): CanvasDoc {
  const cleaned = removeElements(
    doc,
    doc.nodes.filter((node) => node.proposed).map((node) => node.id)
  );
  return { ...cleaned, edges: cleaned.edges.filter((edge) => !edge.proposed) };
}

/** Session-only undo: snapshots of the document before each change. */
export class UndoStack {
  private readonly past: CanvasDoc[] = [];
  constructor(private readonly limit = 100) {}

  push(doc: CanvasDoc): void {
    if (this.past[this.past.length - 1] === doc) return;
    this.past.push(doc);
    if (this.past.length > this.limit) this.past.shift();
  }

  pop(): CanvasDoc | undefined {
    return this.past.pop();
  }

  get size(): number {
    return this.past.length;
  }
}

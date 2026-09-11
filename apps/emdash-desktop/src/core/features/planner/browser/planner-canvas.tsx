import '@xyflow/react/dist/base.css';
import './planner.css';
import { Button, toast } from '@emdash/ui/react/primitives';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasDoc, CanvasNode } from '@core/features/planner/api';
import { getPlannerClient } from '@core/features/planner/api/browser/client';
import { cycleEdgeIds, flattenCanvas } from '@core/features/planner/api/flatten';
import * as model from './canvas-model';
import { DraftFromBriefModal } from './draft-modal';
import { PlannerNodeActionsContext, plannerNodeTypes, type PlannerNodeActions } from './planner-nodes';
import { PlannerToolbar } from './planner-toolbar';
import { usePlannerNodeStates } from './use-node-states';

export interface PlannerCanvasProps {
  projectId: string;
  canvasId: string;
  /** Persisted pan and zoom; when absent the canvas fits its content. */
  viewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  saveDebounceMs?: number;
}

type Cycle = { nodes: Set<string>; edges: Set<string> };
const NO_CYCLE: Cycle = { nodes: new Set(), edges: new Set() };

export function PlannerCanvas(props: PlannerCanvasProps) {
  return (
    <ReactFlowProvider>
      <PlannerCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function PlannerCanvasInner({ projectId, canvasId, viewport, onViewportChange, saveDebounceMs = 600 }: PlannerCanvasProps) {
  const flow = useReactFlow();
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<string | undefined>();
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle>(NO_CYCLE);
  const [saveLabel, setSaveLabel] = useState('');
  const [running, setRunning] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const states = usePlannerNodeStates(projectId, canvasId);

  const docRef = useRef<CanvasDoc | null>(null);
  docRef.current = doc;
  const undo = useRef(new model.UndoStack());
  const clipboard = useRef<model.ClipboardPayload | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const client = await getPlannerClient();
      const result = await client.getCanvas({ projectId, canvasId });
      if (cancelled) return;
      if (!result.success) {
        setLoadError(result.error.message);
        return;
      }
      if (result.data.recovered) {
        toast.warning('The saved canvas was unreadable', { description: 'Starting from an empty canvas.' });
      }
      setDoc(result.data.doc);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, canvasId]);

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const current = docRef.current;
    if (!current || !dirty.current) return true;
    dirty.current = false;
    setSaveLabel('Saving…');
    const result = await (await getPlannerClient()).saveCanvas({ doc: current });
    if (!result.success) {
      dirty.current = true;
      setSaveLabel('Not saved');
      toast.error('Could not save the canvas', { description: result.error.message });
      return false;
    }
    setSaveLabel('Saved');
    return true;
  }, []);

  useEffect(() => () => void save(), [save]);

  /** Every document edit goes through here: undo snapshot, cycle reset, debounced save. */
  const change = useCallback(
    (update: (current: CanvasDoc) => CanvasDoc) => {
      const current = docRef.current;
      if (!current) return;
      const next = update(current);
      if (next === current) return;
      undo.current.push(current);
      docRef.current = next;
      setDoc(next);
      setCycle(NO_CYCLE);
      dirty.current = true;
      setSaveLabel('Unsaved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), saveDebounceMs);
    },
    [save, saveDebounceMs]
  );

  const derivedNodes = useMemo(
    () => (doc ? model.toFlowNodes(doc, scope, { states, cycleNodes: cycle.nodes, selected: selectedNodes }) : []),
    [doc, scope, states, cycle, selectedNodes]
  );
  const derivedEdges = useMemo(
    () => (doc ? model.toFlowEdges(doc, scope, { cycleEdges: cycle.edges, selected: selectedEdges }) : []),
    [doc, scope, cycle, selectedEdges]
  );
  // xyflow owns transient state (drag positions, measured sizes); the doc owns the truth.
  const [nodes, setNodes] = useState<model.PlannerFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);
  useEffect(() => setEdges(derivedEdges), [derivedEdges]);

  const onNodesChange = useCallback((changes: NodeChange<model.PlannerFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), current));
  }, []);
  const onSelectionChange = useCallback(({ nodes: n, edges: e }: OnSelectionChangeParams) => {
    setSelectedNodes(new Set(n.map((node) => node.id)));
    setSelectedEdges(new Set(e.map((edge) => edge.id)));
  }, []);

  const commitPositions = useCallback(
    (_event: unknown, _node: unknown, dragged: model.PlannerFlowNode[]) =>
      change((d) => model.moveNodes(d, new Map(dragged.map((node) => [node.id, node.position])))),
    [change]
  );

  const deleteSelection = useCallback(() => {
    if (selectedNodes.size === 0 && selectedEdges.size === 0) return;
    change((d) => model.removeElements(d, selectedNodes, selectedEdges));
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
  }, [change, selectedNodes, selectedEdges]);

  const addNode = useCallback(
    (type: model.PlannerNodeType) => {
      const rect = document.querySelector('.planner-flow')?.getBoundingClientRect();
      const center = rect
        ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      const position = { x: center.x - 100, y: center.y - 30 };
      const base = { position, parentId: scope };
      const node: CanvasNode =
        type === 'job'
          ? { ...base, id: model.newPlannerId('n'), type: 'job', title: 'New job', kind: 'work' }
          : type === 'note'
            ? { ...base, id: model.newPlannerId('n'), type: 'note', text: '' }
            : { ...base, id: model.newPlannerId('m'), type: 'module', title: 'New module', size: { width: 320, height: 220 } };
      change((d) => model.addNodes(d, [node]));
      setEditingId(node.id);
    },
    [change, flow, scope]
  );

  const runPlan = useCallback(async () => {
    if (running || !docRef.current) return;
    setRunning(true);
    try {
      if (!(await save())) return;
      const result = await (await getPlannerClient()).compile({ projectId, canvasId });
      if (!result.success) {
        toast.error('Plan not run', { description: result.error.message });
        return;
      }
      const path = result.data.cycles?.[0];
      if (path) {
        const current = docRef.current;
        const flat = flattenCanvas(current);
        setCycle({ nodes: new Set(path), edges: cycleEdgeIds(flat, path) });
        const titles = new Map(current.nodes.map((n) => [n.id, n.type === 'note' ? n.id : n.title]));
        toast.error('The plan has a dependency cycle', {
          description: path.map((id) => titles.get(id) ?? id).join(' → '),
        });
        return;
      }
      const { created, updated, archived } = result.data;
      toast.success('Plan compiled', { description: `${created} created, ${updated} updated, ${archived} archived` });
    } finally {
      setRunning(false);
    }
  }, [running, save, projectId, canvasId]);

  const draft = useCallback(
    async (brief: string): Promise<string | null> => {
      await save();
      const result = await (await getPlannerClient()).draftFromBrief({ projectId, canvasId, brief });
      if (!result.success) return result.error.message;
      change((d) => model.mergeProposal(d, result.data, scope));
      return null;
    },
    [change, save, projectId, canvasId, scope]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isTyping(event.target) || draftOpen) return;
      const mod = event.metaKey || event.ctrlKey;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        handled();
        deleteSelection();
      } else if (mod && event.key === 'Enter') {
        handled();
        void runPlan();
      } else if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        handled();
        const previous = undo.current.pop();
        if (previous) {
          docRef.current = previous;
          setDoc(previous);
          dirty.current = true;
          saveTimer.current = setTimeout(() => void save(), saveDebounceMs);
        }
      } else if (mod && event.key.toLowerCase() === 'c' && docRef.current && selectedNodes.size > 0) {
        handled();
        clipboard.current = model.copySelection(docRef.current, selectedNodes);
      } else if (mod && event.key.toLowerCase() === 'v' && clipboard.current) {
        handled();
        const payload = clipboard.current;
        let pasted: string[] = [];
        change((d) => {
          const out = model.pasteClipboard(d, payload, scope);
          pasted = out.pastedIds;
          return out.doc;
        });
        setSelectedNodes(new Set(pasted));
      } else if (event.key === 'Escape' && scope !== undefined && docRef.current) {
        handled();
        setScope(docRef.current.nodes.find((n) => n.id === scope)?.parentId);
      }
    },
    [change, deleteSelection, draftOpen, runPlan, save, saveDebounceMs, scope, selectedNodes]
  );

  const actions = useMemo<PlannerNodeActions>(
    () => ({
      editingId,
      cancelEdit: () => setEditingId(null),
      commitEdit: (id, value) => {
        setEditingId(null);
        change((d) =>
          model.updateNode(d, id, (node) => {
            if (node.type === 'note') return { ...node, text: value };
            const title = value.trim();
            return title ? { ...node, title: title.slice(0, 200) } : node;
          })
        );
      },
      resizeModule: (id, rect) =>
        change((d) =>
          model.updateNode(model.resizeModule(d, id, rect), id, (node) => ({ ...node, position: { x: rect.x, y: rect.y } }))
        ),
      drillDown: (id) => {
        setScope(id);
        setSelectedNodes(new Set());
      },
    }),
    [change, editingId]
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => void flow.fitView({ padding: 0.2, maxZoom: 1.2 }));
    return () => cancelAnimationFrame(id);
    // Refit when the user drills in or out, not on every edit.
  }, [scope, flow]);

  const crumbs = useMemo(() => {
    const path = doc ? model.breadcrumbPath(doc, scope) : [];
    return [
      { id: 'root', label: doc?.title ?? 'Plan', onSelect: () => setScope(undefined) },
      ...path.map((item) => ({ id: item.id, label: item.title, onSelect: () => setScope(item.id) })),
    ];
  }, [doc, scope]);

  if (loadError) {
    return <div className="p-6 text-sm text-foreground-muted">Could not open this canvas: {loadError}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col outline-none" tabIndex={0} onKeyDownCapture={onKeyDown} data-testid="planner-canvas">
      <PlannerToolbar
        crumbs={crumbs}
        saveLabel={saveLabel}
        running={running}
        onAdd={addNode}
        onDraft={() => setDraftOpen(true)}
        onRun={() => void runPlan()}
      />
      <div className="relative min-h-0 flex-1">
        <PlannerNodeActionsContext.Provider value={actions}>
          <ReactFlow
            className="planner-flow"
            nodes={nodes}
            edges={edges}
            nodeTypes={plannerNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onConnect={(connection) => change((d) => model.connect(d, connection.source, connection.target))}
            onNodeDragStop={commitPositions}
            onSelectionDragStop={(event, dragged) => commitPositions(event, null, dragged as model.PlannerFlowNode[])}
            onNodeDoubleClick={(_event, node) =>
              node.type === 'module' ? actions.drillDown(node.id) : setEditingId(node.id)
            }
            onMoveEnd={(_event, next) => onViewportChange?.(next)}
            defaultViewport={viewport}
            fitView={viewport === undefined}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            minZoom={0.1}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
            {doc && model.hasProposals(doc) ? (
              <Panel position="top-center">
                <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-background-1 px-3 py-1.5 text-xs text-foreground shadow-sm">
                  <span>The Brain proposed a draft. Dashed items are not part of the plan yet.</span>
                  <Button variant="primary" onClick={() => change(model.acceptProposals)}>
                    Accept
                  </Button>
                  <Button variant="ghost" onClick={() => change(model.rejectProposals)}>
                    Reject
                  </Button>
                </div>
              </Panel>
            ) : null}
          </ReactFlow>
        </PlannerNodeActionsContext.Provider>
        {doc && doc.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-foreground-muted">
            Add a job, or draft the plan from a brief.
          </div>
        ) : null}
      </div>
      <DraftFromBriefModal open={draftOpen} onOpenChange={setDraftOpen} onSubmit={draft} />
    </div>
  );
}

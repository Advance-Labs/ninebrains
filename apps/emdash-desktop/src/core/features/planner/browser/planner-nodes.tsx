import { Badge, type BadgeTone } from '@emdash/ui/react/primitives';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, Layers, StickyNote } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PlannerJobState } from '@core/features/planner/api';
import { cn } from '@core/primitives/styling/browser/cn';
import type { PlannerFlowNode } from './canvas-model';

export interface PlannerNodeActions {
  editingId: string | null;
  commitEdit: (id: string, value: string) => void;
  cancelEdit: () => void;
  resizeModule: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  drillDown: (id: string) => void;
}

export const PlannerNodeActionsContext = createContext<PlannerNodeActions | null>(null);

function useActions(): PlannerNodeActions {
  const actions = useContext(PlannerNodeActionsContext);
  if (!actions) throw new Error('planner nodes must render inside PlannerNodeActionsContext');
  return actions;
}

/** Live Brain state -> label and semantic tone. Colours come from the design tokens only. */
export const JOB_STATE_DISPLAY: Record<
  PlannerJobState,
  { label: string; tone: BadgeTone; border: string }
> = {
  proposed: { label: 'Waiting', tone: 'neutral', border: 'var(--em-border)' },
  ready: { label: 'Ready', tone: 'info', border: 'var(--em-border-info)' },
  claimed: { label: 'Claimed', tone: 'info', border: 'var(--em-border-info)' },
  running: { label: 'Running', tone: 'info', border: 'var(--em-border-info)' },
  verifying: { label: 'Verifying', tone: 'warning', border: 'var(--em-border-warning)' },
  done: { label: 'Done', tone: 'success', border: 'var(--em-border-success)' },
  blocked: { label: 'Blocked', tone: 'error', border: 'var(--em-border-error)' },
  failed: { label: 'Failed', tone: 'error', border: 'var(--em-border-error)' },
};

function InlineEditor({
  id,
  initial,
  multiline,
  className,
}: {
  id: string;
  initial: string;
  multiline?: boolean;
  className?: string;
}) {
  const { commitEdit, cancelEdit } = useActions();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.select(), []);
  const props = {
    ref,
    value,
    'aria-label': multiline ? 'Note text' : 'Title',
    className: cn(
      'nodrag nowheel w-full rounded-sm border border-border bg-background px-1 py-0.5 text-foreground outline-none',
      className
    ),
    onChange: (event: { target: { value: string } }) => setValue(event.target.value),
    onBlur: () => commitEdit(id, value),
    onKeyDown: (event: React.KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') cancelEdit();
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey))
        commitEdit(id, value);
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input {...props} />;
}

const cardBase = 'rounded-md border bg-background-1 text-foreground shadow-sm transition-shadow';

export function JobNode({ id, data, selected }: NodeProps<PlannerFlowNode>) {
  const { editingId } = useActions();
  const node = data.canvasNode;
  if (node.type !== 'job') return null;
  const state = data.state ? JOB_STATE_DISPLAY[data.state] : undefined;
  return (
    <div
      data-testid={`planner-node-${id}`}
      data-state={data.state ?? 'uncompiled'}
      data-in-cycle={data.inCycle || undefined}
      className={cn(
        cardBase,
        'w-56 border-l-4 px-3 py-2',
        node.proposed && 'border-dashed opacity-80',
        selected && 'ring-2 ring-[var(--em-border-primary)]',
        data.inCycle && 'ring-2 ring-[var(--em-foreground-error)]'
      )}
      style={{ borderLeftColor: state?.border ?? 'var(--em-border)' }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-tiny tracking-wide text-foreground-muted uppercase">
          {node.kind === 'review' ? 'Review' : 'Job'}
        </span>
        {node.proposed ? (
          <Badge variant="outline">Proposed</Badge>
        ) : state ? (
          <Badge tone={state.tone}>{state.label}</Badge>
        ) : null}
      </div>
      {editingId === id ? (
        <InlineEditor id={id} initial={node.title} className="mt-1 text-sm" />
      ) : (
        <div className="mt-1 line-clamp-2 text-sm font-medium" title={node.title}>
          {node.title}
        </div>
      )}
      {node.gates && node.gates.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.gates.map((gate) => (
            <Badge key={gate} variant="outline">
              {gate}
            </Badge>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function NoteNode({ id, data, selected }: NodeProps<PlannerFlowNode>) {
  const { editingId } = useActions();
  const node = data.canvasNode;
  if (node.type !== 'note') return null;
  return (
    <div
      data-testid={`planner-node-${id}`}
      className={cn(
        'w-52 rounded-md border border-border bg-background-secondary px-3 py-2 text-foreground-muted',
        node.proposed && 'border-dashed',
        selected && 'ring-2 ring-[var(--em-border-primary)]'
      )}
    >
      <div className="mb-1 flex items-center gap-1 text-tiny tracking-wide uppercase">
        <StickyNote className="size-3" aria-hidden /> Note
      </div>
      {editingId === id ? (
        <InlineEditor id={id} initial={node.text} multiline className="text-xs" />
      ) : (
        <p className="text-xs whitespace-pre-wrap">{node.text || 'Double-click to write'}</p>
      )}
    </div>
  );
}

export function ModuleNode({ id, data, selected }: NodeProps<PlannerFlowNode>) {
  const { editingId, resizeModule, drillDown } = useActions();
  const node = data.canvasNode;
  if (node.type !== 'module') return null;
  return (
    <div
      data-testid={`planner-node-${id}`}
      className={cn(
        'h-full w-full rounded-lg border bg-background-secondary/40',
        node.proposed ? 'border-dashed border-border' : 'border-border',
        selected && 'ring-2 ring-[var(--em-border-primary)]',
        data.inCycle && 'ring-2 ring-[var(--em-foreground-error)]'
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        onResizeEnd={(_event, rect) => resizeModule(id, rect)}
      />
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Layers className="size-3.5 text-foreground-muted" aria-hidden />
        {editingId === id ? (
          <InlineEditor id={id} initial={node.title} className="text-xs" />
        ) : (
          <span className="truncate text-xs font-medium text-foreground">{node.title}</span>
        )}
        <span className="ml-auto text-tiny text-foreground-muted">
          {data.jobCount} {data.jobCount === 1 ? 'job' : 'jobs'}
        </span>
        <button
          type="button"
          className="nodrag flex items-center rounded-sm p-0.5 text-foreground-muted hover:bg-background-2 hover:text-foreground"
          aria-label={`Open ${node.title}`}
          onClick={() => drillDown(id)}
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const plannerNodeTypes = { job: JobNode, note: NoteNode, module: ModuleNode };

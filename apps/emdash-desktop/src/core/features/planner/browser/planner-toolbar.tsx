import { Breadcrumbs, Button, Kbd, type BreadcrumbItem } from '@emdash/ui/react/primitives';
import { Layers, Loader2, Play, Plus, Sparkles, StickyNote } from 'lucide-react';
import type { PlannerNodeType } from './canvas-model';

export interface PlannerToolbarProps {
  crumbs: readonly BreadcrumbItem[];
  saveLabel: string;
  running: boolean;
  onAdd: (type: PlannerNodeType) => void;
  onDraft: () => void;
  onRun: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export function PlannerToolbar({ crumbs, saveLabel, running, onAdd, onDraft, onRun }: PlannerToolbarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Breadcrumbs items={crumbs} label="Canvas" className="min-w-0 flex-1 text-sm" />
      <span className="text-tiny text-foreground-passive" aria-live="polite">
        {saveLabel}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" onClick={() => onAdd('job')}>
          <Plus className="size-3.5" aria-hidden /> Job
        </Button>
        <Button variant="ghost" onClick={() => onAdd('note')}>
          <StickyNote className="size-3.5" aria-hidden /> Note
        </Button>
        <Button variant="ghost" onClick={() => onAdd('module')}>
          <Layers className="size-3.5" aria-hidden /> Module
        </Button>
        <Button variant="secondary" onClick={onDraft}>
          <Sparkles className="size-3.5" aria-hidden /> Draft from brief
        </Button>
        <Button variant="primary" onClick={onRun} disabled={running} aria-label="Run plan">
          {running ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          Run plan
          <Kbd>{isMac ? '⌘↵' : 'Ctrl+↵'}</Kbd>
        </Button>
      </div>
    </div>
  );
}

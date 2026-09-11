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

/** Labels collapse to icons below `md`; every button keeps an accessible name. */
const label = 'max-md:sr-only';

export function PlannerToolbar({ crumbs, saveLabel, running, onAdd, onDraft, onRun }: PlannerToolbarProps) {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-background px-3 py-1">
      <Breadcrumbs items={crumbs} label="Canvas" className="min-w-32 flex-1 text-sm" />
      <span className="text-tiny text-foreground-passive max-md:hidden" aria-live="polite">
        {saveLabel}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" onClick={() => onAdd('job')} aria-label="Add job">
          <Plus className="size-3.5" aria-hidden /> <span className={label}>Job</span>
        </Button>
        <Button variant="ghost" onClick={() => onAdd('note')} aria-label="Add note">
          <StickyNote className="size-3.5" aria-hidden /> <span className={label}>Note</span>
        </Button>
        <Button variant="ghost" onClick={() => onAdd('module')} aria-label="Add module">
          <Layers className="size-3.5" aria-hidden /> <span className={label}>Module</span>
        </Button>
        <Button variant="secondary" onClick={onDraft} aria-label="Draft from brief">
          <Sparkles className="size-3.5" aria-hidden /> <span className={label}>Draft from brief</span>
        </Button>
        <Button variant="primary" onClick={onRun} disabled={running} aria-label="Run plan">
          {running ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          Run plan
          <Kbd className="max-md:hidden">{isMac ? '⌘↵' : 'Ctrl+↵'}</Kbd>
        </Button>
      </div>
    </div>
  );
}

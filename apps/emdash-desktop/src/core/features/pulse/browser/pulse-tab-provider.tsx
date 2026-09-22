import { Activity } from 'lucide-react';
import type { TaskTabContext } from '@core/features/workbench/api/browser/tabs/task-tab-context';
import type {
  ResolvedTab,
  TabBarItemProps,
  TabContentProps,
  TabEntry,
  TabProvider,
  TabResource,
  TabViewContext,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import { createTabProvider } from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider-registry';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item';
import { PulseTabContent } from './pulse-tab-content';

export interface PulseTabState {
  taskId: string;
}

export type PulseTabOpenArgs = Record<string, never>;

interface PulseTabResourceView extends TabResource {
  readonly taskId: string;
}

class PulseTabResource implements PulseTabResourceView {
  constructor(readonly taskId: string) {}
  dispose(): void {}
}

function PulseIcon() {
  return <Activity className="size-4 shrink-0" />;
}

const PulseTabBarItem = ({ tab, host, ctx }: TabBarItemProps<PulseTabResourceView>) => (
  <GenericTabItem tab={tab} host={host} ctx={ctx} label="Pulse" preSlot={<PulseIcon />} />
);

const PulseTabBarItemDragPreview = (_props: { tab: ResolvedTab<PulseTabResourceView> }) => (
  <GenericTabDragPreview preSlot={<PulseIcon />} label="Pulse" />
);

const PulseTabContentView = ({ ctx }: TabContentProps) => {
  const taskCtx = ctx as TaskTabContext;
  return <PulseTabContent projectId={taskCtx.projectId} taskId={taskCtx.taskId} />;
};

/**
 * One Pulse tab per task (`mount: 'single'`, a constant resource key), opened
 * via the `task.openPulse` command rather than any per-instance open args.
 */
export const pulseTabProvider: TabProvider<
  'pulse',
  PulseTabState,
  PulseTabResourceView,
  PulseTabOpenArgs
> = createTabProvider({
  kind: 'pulse',
  mount: 'single',
  resourceKey: () => 'pulse',

  onBeforeOpen(_args: PulseTabOpenArgs, ctx: TabViewContext): PulseTabState {
    const taskCtx = ctx as TaskTabContext;
    return { taskId: taskCtx.taskId };
  },

  initialize(entry: TabEntry<PulseTabState>): PulseTabResourceView {
    return new PulseTabResource(entry.state.taskId);
  },

  dispose(_entry: TabEntry<PulseTabState>, resource: PulseTabResourceView): void {
    resource.dispose();
  },

  TabBarItem: PulseTabBarItem,
  TabBarItemDragPreview: PulseTabBarItemDragPreview,
  TabContent: PulseTabContentView,
});

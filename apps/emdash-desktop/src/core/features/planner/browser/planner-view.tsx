import type { Viewport } from '@xyflow/react';
import { useCallback, type ReactNode } from 'react';
import {
  plannerCanvasSubject,
  plannerViewportMemento,
} from '@core/features/planner/contributions/mementos';
import { DEFAULT_CANVAS_ID, plannerViewDef } from '@core/features/planner/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { SubjectProvider } from '@core/primitives/mementos/react';
import { useMemento } from '@core/primitives/mementos/react/use-memento';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { defineViewRuntime } from '@core/primitives/views/react';
import { PlannerCanvas } from './planner-canvas';

function PlannerWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function PlannerTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <nav aria-label="Breadcrumb" className="flex items-center px-2">
          <span className="truncate rounded-sm px-1 py-0.5 text-sm text-foreground">Planner</span>
        </nav>
      }
    />
  );
}

function PersistedViewportCanvas({ projectId, canvasId }: { projectId: string; canvasId: string }) {
  const [stored, setStored] = useMemento(plannerViewportMemento);
  const onViewportChange = useCallback(
    (next: Viewport) => setStored({ version: '1', x: next.x, y: next.y, zoom: next.zoom }),
    [setStored]
  );
  // The memento default (0, 0, 1) means "never moved": let the canvas fit its content instead.
  const viewport = stored.x === 0 && stored.y === 0 && stored.zoom === 1 ? undefined : stored;
  return (
    <PlannerCanvas
      projectId={projectId}
      canvasId={canvasId}
      viewport={viewport}
      onViewportChange={onViewportChange}
    />
  );
}

function PlannerMainPanel() {
  const { params } = useCurrentViewParams(plannerViewDef);
  const canvasId = params.canvasId ?? DEFAULT_CANVAS_ID;
  return (
    <SubjectProvider subject={plannerCanvasSubject({ projectId: params.projectId, canvasId })}>
      <PersistedViewportCanvas
        key={`${params.projectId}/${canvasId}`}
        projectId={params.projectId}
        canvasId={canvasId}
      />
    </SubjectProvider>
  );
}

export const plannerViewRuntime = defineViewRuntime(plannerViewDef, {
  slots: {
    wrap: PlannerWrapper,
    titlebar: PlannerTitlebar,
    main: PlannerMainPanel,
  },
});

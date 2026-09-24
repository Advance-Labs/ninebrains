import { Button } from '@emdash/ui/react/primitives';
import type { Viewport } from '@xyflow/react';
import { useCallback, type ReactNode } from 'react';
import { BrainStopButton } from '@core/features/brain/contributions/planner-controls';
import { lanesViewDef } from '@core/features/lanes/contributions/views';
import {
  plannerCanvasSubject,
  plannerViewportMemento,
} from '@core/features/planner/contributions/mementos';
import { DEFAULT_CANVAS_ID, plannerViewDef } from '@core/features/planner/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { SubjectProvider } from '@core/primitives/mementos/react';
import { useMemento } from '@core/primitives/mementos/react/use-memento';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { defineViewRuntime } from '@core/primitives/views/react';
import { PlannerCanvas } from './planner-canvas';

function PlannerWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * The Planner renders its own titlebar, so whatever it leaves out is simply absent here. It
 * previously left out both halves of the way back: no route to Lanes (only Lanes knows how to
 * reach the Planner, so the trip was one-way) and no global STOP while a plan runs.
 */
function PlannerTitlebar() {
  const { navigate } = useNavigate();
  return (
    <Titlebar
      leftSlot={
        <nav aria-label="Breadcrumb" className="flex items-center gap-0.5 px-2">
          <Button
            size="sm"
            variant="ghost"
            data-testid="planner-open-lanes"
            onClick={() => navigate(lanesViewDef({}))}
          >
            Lanes
          </Button>
          <span aria-hidden className="text-sm text-foreground-passive">
            /
          </span>
          <span
            aria-current="page"
            className="truncate rounded-sm px-1 py-0.5 text-sm text-foreground"
          >
            Planner
          </span>
        </nav>
      }
      rightSlot={
        <div className="flex items-center pr-2">
          <BrainStopButton />
        </div>
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

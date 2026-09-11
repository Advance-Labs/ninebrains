import type { CanvasDoc, PlannerJobState } from '@core/features/planner/api';

/** A representative canvas for browser tests and screenshots. */
export const PLANNER_FIXTURE_DOC: CanvasDoc = {
  version: 1,
  projectId: 'p1',
  canvasId: 'c1',
  title: 'Launch login',
  updatedAt: 1,
  nodes: [
    {
      id: 'backend',
      type: 'module',
      position: { x: 300, y: 40 },
      title: 'Backend',
      size: { width: 520, height: 230 },
    },
    { id: 'design', type: 'job', position: { x: 0, y: 110 }, title: 'Design the auth schema', kind: 'work' },
    {
      id: 'api',
      type: 'job',
      parentId: 'backend',
      position: { x: 20, y: 60 },
      title: 'Magic-link API',
      kind: 'work',
      gates: ['tests'],
    },
    {
      id: 'mail',
      type: 'job',
      parentId: 'backend',
      position: { x: 272, y: 60 },
      title: 'Email sender',
      kind: 'work',
      gates: ['tests'],
    },
    {
      id: 'ui',
      type: 'job',
      position: { x: 900, y: 110 },
      title: 'Login page UI',
      kind: 'work',
      gates: ['screenshot'],
    },
    {
      id: 'review',
      type: 'job',
      position: { x: 1200, y: 110 },
      title: 'Security review',
      kind: 'review',
      gates: ['reviewer'],
    },
    {
      id: 'note',
      type: 'note',
      position: { x: 0, y: 300 },
      text: 'Magic links only. No passwords in v0.1.',
    },
  ],
  edges: [
    { id: 'e-design-backend', source: 'design', target: 'backend' },
    { id: 'e-backend-ui', source: 'backend', target: 'ui' },
    { id: 'e-ui-review', source: 'ui', target: 'review' },
  ],
};

export const PLANNER_FIXTURE_STATES: Record<string, PlannerJobState> = {
  design: 'done',
  api: 'running',
  mail: 'verifying',
  ui: 'ready',
  review: 'proposed',
};

/** The fixture plus an edge back to the start, which closes a cycle. */
export const PLANNER_FIXTURE_CYCLE_DOC: CanvasDoc = {
  ...PLANNER_FIXTURE_DOC,
  edges: [
    ...PLANNER_FIXTURE_DOC.edges,
    { id: 'e-review-design', source: 'review', target: 'design' },
  ],
};

export const PLANNER_FIXTURE_CYCLE_PATH = ['design', 'api', 'ui', 'review', 'design'];

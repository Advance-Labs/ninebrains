import type { Result } from '@emdash/shared';
import type { MementoModelKey, MementoRow } from '@core/primitives/mementos/api';
import type {
  CanvasDoc,
  CanvasSummary,
  DraftProposal,
  PlannerError,
  PlannerGateKind,
  PlannerJobKind,
  PlannerJobState,
} from '../api';

/** One job handed to the Brain. `id` is the canvas node id: the idempotent upsert key. */
export interface PlanJob {
  id: string;
  title: string;
  body?: string;
  kind?: PlannerJobKind;
  gateKind?: PlannerGateKind;
  gates?: string[];
}

export interface PlanCompileRequest {
  planId: string;
  projectId: string;
  jobs: PlanJob[];
  /** `to` depends on `from`, both canvas node ids. */
  edges: Array<{ from: string; to: string }>;
}

export type PlanCompileResult =
  | { ok: true; created: number; updated: number; unchanged: number; archived: number }
  /** `path` is canvas node ids where they are known, first node repeated at the end. */
  | { ok: false; kind: 'cycle'; path: string[] }
  | { ok: false; kind: 'invalid'; message: string };

/** Port: where a compiled plan goes (the Brain), plus read access to its job states. */
export interface PlanTarget {
  compile(request: PlanCompileRequest): PlanCompileResult | Promise<PlanCompileResult>;
  /** Current job state per canvas node id, for live status colours. Archived jobs are omitted. */
  jobStates(
    projectId: string,
    planId: string
  ): Record<string, PlannerJobState> | Promise<Record<string, PlannerJobState>>;
  /** Called whenever any job may have changed. Returns an unsubscribe function. */
  subscribe?(listener: () => void): () => void;
}

export interface CanvasLoadResult {
  doc: CanvasDoc | null;
  /** The stored document was corrupt, oversized or mismatched and was ignored. */
  recovered: boolean;
}

/** Port: canvas document persistence. v0.1 = mementos; later the Brain DB `canvases` table. */
export interface CanvasStore {
  list(projectId: string): Promise<CanvasSummary[]>;
  load(projectId: string, canvasId: string): Promise<CanvasLoadResult>;
  save(doc: CanvasDoc): Promise<void>;
}

/** Port: turns a free-text brief into proposed nodes and edges. The Brain implements it later. */
export interface BriefDrafter {
  draftFromBrief(
    projectId: string,
    brief: string,
    context: { canvasId: string; doc: CanvasDoc | null }
  ): Promise<Result<DraftProposal, PlannerError>>;
}

/** The slice of the mementos runtime the canvas store needs: raw row read and write. */
export interface MementoRowPort {
  read(key: MementoModelKey): Promise<MementoRow | null>;
  write(key: MementoModelKey, row: MementoRow): Promise<void>;
}

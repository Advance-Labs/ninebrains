import { z } from 'zod';

/**
 * Hard limits for a canvas document. They are checked when a document is
 * loaded from storage, when it is saved, and before it is compiled, so a
 * corrupt or oversized document can never reach the canvas or the Brain.
 */
export const PLANNER_LIMITS = {
  /** Matches brain-core's `LIMITS.planNodes`, so every valid canvas compiles. */
  nodes: 500,
  edges: 2_000,
  titleChars: 200,
  bodyChars: 8_000,
  briefChars: 8_000,
  gatesPerJob: 10,
  /** Serialized JSON size of one canvas document. */
  docBytes: 512 * 1024,
  canvasesPerProject: 200,
} as const;

/** The same rule as brain-core's `ID_PATTERN` (SEC-14): a safe path segment. */
export const PLANNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const plannerIdSchema = z.string().regex(PLANNER_ID_PATTERN);

/** Mirrors brain-core `JOB_STATES`; a node test keeps the two in step. */
export const PLANNER_JOB_STATES = [
  'proposed',
  'ready',
  'claimed',
  'running',
  'verifying',
  'done',
  'blocked',
  'failed',
] as const;
export const plannerJobStateSchema = z.enum(PLANNER_JOB_STATES);
export type PlannerJobState = z.infer<typeof plannerJobStateSchema>;

export const plannerJobKindSchema = z.enum(['work', 'review']);
export type PlannerJobKind = z.infer<typeof plannerJobKindSchema>;

const finite = z.number().finite();
const positionSchema = z.object({ x: finite, y: finite });

const nodeBase = {
  id: plannerIdSchema,
  position: positionSchema,
  /** The module this node sits inside. Absent for top-level nodes. */
  parentId: plannerIdSchema.optional(),
  /** Drafted by the Brain and not accepted yet. Proposed nodes never compile. */
  proposed: z.boolean().optional(),
};

export const jobNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('job'),
  title: z.string().trim().min(1).max(PLANNER_LIMITS.titleChars),
  body: z.string().max(PLANNER_LIMITS.bodyChars).optional(),
  kind: plannerJobKindSchema.optional(),
  gates: z.array(z.string().min(1).max(40)).max(PLANNER_LIMITS.gatesPerJob).optional(),
});

export const noteNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('note'),
  text: z.string().max(PLANNER_LIMITS.bodyChars),
});

export const moduleNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('module'),
  title: z.string().trim().min(1).max(PLANNER_LIMITS.titleChars),
  size: z.object({ width: finite.min(120).max(10_000), height: finite.min(80).max(10_000) }),
});

export const canvasNodeSchema = z.discriminatedUnion('type', [
  jobNodeSchema,
  noteNodeSchema,
  moduleNodeSchema,
]);

/** `target` depends on `source`: the source job must finish first. */
export const canvasEdgeSchema = z.object({
  id: plannerIdSchema,
  source: plannerIdSchema,
  target: plannerIdSchema,
  proposed: z.boolean().optional(),
});

export type JobNode = z.infer<typeof jobNodeSchema>;
export type NoteNode = z.infer<typeof noteNodeSchema>;
export type ModuleNode = z.infer<typeof moduleNodeSchema>;
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export const canvasDocSchema = z
  .object({
    version: z.literal(1),
    projectId: plannerIdSchema,
    canvasId: plannerIdSchema,
    title: z.string().trim().min(1).max(PLANNER_LIMITS.titleChars),
    nodes: z.array(canvasNodeSchema).max(PLANNER_LIMITS.nodes),
    edges: z.array(canvasEdgeSchema).max(PLANNER_LIMITS.edges),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((doc, ctx) => {
    for (const problem of canvasIntegrityProblems(doc)) {
      ctx.addIssue({ code: 'custom', message: problem });
    }
  });

export type CanvasDoc = z.infer<typeof canvasDocSchema>;

export const canvasSummarySchema = z.object({
  canvasId: plannerIdSchema,
  title: z.string(),
  updatedAt: z.number().int().nonnegative(),
});
export type CanvasSummary = z.infer<typeof canvasSummarySchema>;

/** Referential checks the per-field schema can't express. Returns human-readable problems. */
export function canvasIntegrityProblems(doc: Pick<CanvasDoc, 'nodes' | 'edges'>): string[] {
  const problems: string[] = [];
  const byId = new Map<string, CanvasNode>();
  for (const node of doc.nodes) {
    if (byId.has(node.id)) problems.push(`duplicate node id ${node.id}`);
    byId.set(node.id, node);
  }
  for (const node of doc.nodes) {
    if (node.parentId === undefined) continue;
    const parent = byId.get(node.parentId);
    if (parent?.type !== 'module') problems.push(`node ${node.id} has a parent that is not a module`);
  }
  for (const node of doc.nodes) {
    const seen = new Set<string>([node.id]);
    let cursor = node.parentId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        problems.push(`module nesting loops at ${node.id}`);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of doc.edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      problems.push(`edge ${edge.id} references an unknown node`);
    }
    if (edge.source === edge.target) problems.push(`edge ${edge.id} links a node to itself`);
  }
  return problems;
}

export type CanvasParseResult =
  | { readonly ok: true; readonly doc: CanvasDoc }
  | { readonly ok: false; readonly reason: string };

/**
 * The single entry point for untrusted canvas JSON (storage, IPC). Never
 * throws: a corrupt, oversized or malformed document is reported, not raised.
 */
export function parseCanvasDoc(raw: unknown): CanvasParseResult {
  let value = raw;
  if (typeof raw === 'string') {
    if (utf8Length(raw) > PLANNER_LIMITS.docBytes) return { ok: false, reason: 'document too large' };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'document is not valid JSON' };
    }
  } else {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(raw);
    } catch {
      return { ok: false, reason: 'document is not serializable' };
    }
    if (serialized === undefined) return { ok: false, reason: 'document is empty' };
    if (utf8Length(serialized) > PLANNER_LIMITS.docBytes) {
      return { ok: false, reason: 'document too large' };
    }
  }
  const parsed = canvasDocSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid document' };
  }
  return { ok: true, doc: parsed.data };
}

export function emptyCanvasDoc(projectId: string, canvasId: string, now: number): CanvasDoc {
  return { version: 1, projectId, canvasId, title: 'Plan', nodes: [], edges: [], updatedAt: now };
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

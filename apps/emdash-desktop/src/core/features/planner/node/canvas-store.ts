import { z } from 'zod';
import type { MementoModelKey, MementoRow } from '@core/primitives/mementos/api';
import { canvasSummarySchema, parseCanvasDoc, PLANNER_LIMITS, type CanvasSummary } from '../api';
import type { CanvasStore, MementoRowPort } from './ports';

export const PLANNER_MEMENTO_IDS = {
  doc: 'planner.canvas-doc',
  index: 'planner.canvas-index',
} as const;

const ROW_VERSION = '1';

const docKey = (projectId: string, canvasId: string): MementoModelKey => ({
  mementoId: PLANNER_MEMENTO_IDS.doc,
  kind: 'planner-canvas',
  key: `${projectId}/${canvasId}`,
});

const indexKey = (projectId: string): MementoModelKey => ({
  mementoId: PLANNER_MEMENTO_IDS.index,
  kind: 'planner-project',
  key: projectId,
});

const indexSchema = z.array(canvasSummarySchema).max(PLANNER_LIMITS.canvasesPerProject);

/**
 * v0.1 canvas persistence: one memento row per `{projectId, canvasId}` plus a
 * per-project index row. Every read is validated (size + zod); anything
 * corrupt is reported as `recovered` and never thrown at the view.
 */
export function createMementoCanvasStore(
  port: MementoRowPort,
  options: { now?: () => number } = {}
): CanvasStore {
  const now = options.now ?? Date.now;

  const readIndex = async (projectId: string): Promise<CanvasSummary[]> => {
    const row = await port.read(indexKey(projectId));
    if (!row || row.data.length > PLANNER_LIMITS.docBytes) return [];
    try {
      const parsed = indexSchema.safeParse(JSON.parse(row.data));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };

  return {
    list: readIndex,

    async load(projectId, canvasId) {
      const row = await port.read(docKey(projectId, canvasId));
      if (!row) return { doc: null, recovered: false };
      const parsed = parseCanvasDoc(row.data);
      if (!parsed.ok) return { doc: null, recovered: true };
      if (parsed.doc.projectId !== projectId || parsed.doc.canvasId !== canvasId) {
        return { doc: null, recovered: true };
      }
      return { doc: parsed.doc, recovered: false };
    },

    async save(doc) {
      const parsed = parseCanvasDoc(doc);
      if (!parsed.ok) throw new Error(`refusing to save an invalid canvas: ${parsed.reason}`);
      const updatedAt = now();
      const row: MementoRow = { version: ROW_VERSION, data: JSON.stringify(parsed.doc), updatedAt };
      await port.write(docKey(doc.projectId, doc.canvasId), row);

      const summary: CanvasSummary = { canvasId: doc.canvasId, title: doc.title, updatedAt };
      const index = [
        summary,
        ...(await readIndex(doc.projectId)).filter((c) => c.canvasId !== doc.canvasId),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, PLANNER_LIMITS.canvasesPerProject);
      await port.write(indexKey(doc.projectId), {
        version: ROW_VERSION,
        data: JSON.stringify(index),
        updatedAt,
      });
    },
  };
}

/** A process-local row port for tests and headless use. */
export function createMemoryMementoRowPort(): MementoRowPort & {
  rows: Map<string, MementoRow>;
} {
  const rows = new Map<string, MementoRow>();
  const id = (key: MementoModelKey) => JSON.stringify([key.mementoId, key.kind, key.key]);
  return {
    rows,
    read: async (key) => rows.get(id(key)) ?? null,
    write: async (key, row) => {
      rows.set(id(key), row);
    },
  };
}

import { describe, expect, it } from 'vitest';
import { cycleEdgeIds, flattenCanvas } from './flatten';
import { parseCanvasDoc, PLANNER_LIMITS, type CanvasDoc, type CanvasNode } from './schema';

const job = (id: string, extra: Record<string, unknown> = {}): CanvasNode =>
  ({ id, type: 'job', position: { x: 10, y: 20 }, title: `Job ${id}`, ...extra }) as CanvasNode;

const good = (): CanvasDoc => ({
  version: 1,
  projectId: 'p1',
  canvasId: 'c1',
  title: 'Launch',
  nodes: [
    {
      id: 'm',
      type: 'module',
      position: { x: 0, y: 0 },
      title: 'API',
      size: { width: 400, height: 300 },
    },
    job('a', { parentId: 'm', kind: 'work', gates: ['tests'] }),
    job('b'),
    { id: 'n', type: 'note', position: { x: 0, y: 0 }, text: 'ship Friday' },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b' }],
  updatedAt: 1,
});

describe('canvas document schema', () => {
  it('accepts a well-formed document, as an object or as JSON', () => {
    expect(parseCanvasDoc(good())).toMatchObject({ ok: true });
    expect(parseCanvasDoc(JSON.stringify(good()))).toMatchObject({ ok: true });
  });

  it.each<[string, (doc: CanvasDoc) => unknown]>([
    ['a duplicate node id', (d) => ({ ...d, nodes: [...d.nodes, job('b')] })],
    [
      'an edge to an unknown node',
      (d) => ({ ...d, edges: [{ id: 'e2', source: 'a', target: 'zz' }] }),
    ],
    ['a self edge', (d) => ({ ...d, edges: [{ id: 'e2', source: 'a', target: 'a' }] })],
    [
      'a parent that is not a module',
      (d) => ({ ...d, nodes: [...d.nodes, job('c', { parentId: 'b' })] }),
    ],
    [
      'a module nesting loop',
      (d) => ({
        ...d,
        nodes: [
          {
            id: 'x',
            type: 'module',
            parentId: 'y',
            position: { x: 0, y: 0 },
            title: 'X',
            size: { width: 200, height: 200 },
          },
          {
            id: 'y',
            type: 'module',
            parentId: 'x',
            position: { x: 0, y: 0 },
            title: 'Y',
            size: { width: 200, height: 200 },
          },
        ],
        edges: [],
      }),
    ],
    ['a path-unsafe id', (d) => ({ ...d, nodes: [job('../etc')], edges: [] })],
    ['an empty title', (d) => ({ ...d, nodes: [job('a', { title: '   ' })], edges: [] })],
    [
      'a non-finite position',
      (d) => ({ ...d, nodes: [job('a', { position: { x: Infinity, y: 0 } })], edges: [] }),
    ],
    [
      'an unknown node type',
      (d) => ({ ...d, nodes: [{ id: 'q', type: 'script', position: { x: 0, y: 0 } }] }),
    ],
    ['a wrong version', (d) => ({ ...d, version: 2 })],
    [
      'too many nodes',
      (d) => ({
        ...d,
        nodes: Array.from({ length: PLANNER_LIMITS.nodes + 1 }, (_, i) => job(`j${i}`)),
        edges: [],
      }),
    ],
  ])('rejects %s', (_label, mutate) => {
    expect(parseCanvasDoc(mutate(good()))).toMatchObject({ ok: false });
  });

  it('rejects oversized and unparseable input without throwing', () => {
    const huge = { ...good(), nodes: [job('a', { body: 'x'.repeat(PLANNER_LIMITS.bodyChars) })] };
    const many = {
      ...huge,
      nodes: Array.from({ length: 80 }, (_, i) => job(`j${i}`, { body: 'x'.repeat(7_000) })),
    };
    expect(parseCanvasDoc(many)).toEqual({ ok: false, reason: 'document too large' });
    expect(parseCanvasDoc('x'.repeat(PLANNER_LIMITS.docBytes + 1))).toEqual({
      ok: false,
      reason: 'document too large',
    });
    expect(parseCanvasDoc('{not json')).toEqual({
      ok: false,
      reason: 'document is not valid JSON',
    });
    expect(parseCanvasDoc(null)).toMatchObject({ ok: false });
    expect(parseCanvasDoc(undefined)).toMatchObject({ ok: false });
  });
});

describe('flattenCanvas', () => {
  it('maps module edges to their jobs and remembers which canvas edge carried each pair', () => {
    const doc = good();
    doc.nodes.push(job('c'));
    doc.edges = [
      { id: 'm-c', source: 'm', target: 'c' },
      { id: 'c-b', source: 'c', target: 'b' },
    ];
    const flat = flattenCanvas(doc);
    expect(flat.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(flat.edges).toEqual([
      { from: 'a', to: 'c' },
      { from: 'c', to: 'b' },
    ]);
    expect(cycleEdgeIds(flat, ['a', 'c', 'b'])).toEqual(new Set(['m-c', 'c-b']));
  });
});

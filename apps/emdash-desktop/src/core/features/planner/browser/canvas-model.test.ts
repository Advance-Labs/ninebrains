import { describe, expect, it } from 'vitest';
import type { CanvasDoc } from '@core/features/planner/api';
import { acceptAllProposals, acceptSelectedProposals } from './canvas-model';

function docWith(nodes: CanvasDoc['nodes'], edges: CanvasDoc['edges']): CanvasDoc {
  return {
    version: 1,
    projectId: 'p1',
    canvasId: 'main',
    title: 'Test canvas',
    updatedAt: 0,
    nodes,
    edges,
  };
}

const jobNode = (id: string, proposed: boolean) =>
  ({
    id,
    type: 'job' as const,
    title: id,
    position: { x: 0, y: 0 },
    proposed,
  }) as CanvasDoc['nodes'][number];

describe('acceptAllProposals', () => {
  it('accepts every proposed node and edge', () => {
    const doc = docWith(
      [jobNode('a', true), jobNode('b', true)],
      [{ id: 'e1', source: 'a', target: 'b', proposed: true }]
    );
    const next = acceptAllProposals(doc);
    expect(next.nodes.every((node) => !node.proposed)).toBe(true);
    expect(next.edges.every((edge) => !edge.proposed)).toBe(true);
  });
});

describe('acceptSelectedProposals', () => {
  it('accepts only the selected nodes, leaving the rest proposed', () => {
    const doc = docWith(
      [jobNode('a', true), jobNode('b', true), jobNode('c', false)],
      [{ id: 'e1', source: 'a', target: 'b', proposed: true }]
    );
    const next = acceptSelectedProposals(doc, new Set(['a']));
    expect(next.nodes.find((node) => node.id === 'a')?.proposed).toBeUndefined();
    expect(next.nodes.find((node) => node.id === 'b')?.proposed).toBe(true);
  });

  it('keeps an edge proposed until both of its endpoints are accepted', () => {
    const doc = docWith(
      [jobNode('a', true), jobNode('b', true)],
      [{ id: 'e1', source: 'a', target: 'b', proposed: true }]
    );
    const partial = acceptSelectedProposals(doc, new Set(['a']));
    expect(partial.edges[0]?.proposed).toBe(true);

    const full = acceptSelectedProposals(partial, new Set(['b']));
    expect(full.edges[0]?.proposed).toBeUndefined();
  });

  it('does not accept a proposed edge between two already-accepted nodes it does not touch', () => {
    // The Brain draft can propose a *new* dependency edge between two nodes that
    // already existed on the canvas (mergeProposal marks every draft edge
    // `proposed: true`, even ones whose endpoints were already accepted). A new
    // unrelated node's edge should never pull that one in.
    const doc = docWith(
      [jobNode('existing-a', false), jobNode('existing-b', false), jobNode('new', true)],
      [
        { id: 'e-existing', source: 'existing-a', target: 'existing-b', proposed: true },
        { id: 'e-new', source: 'new', target: 'existing-a', proposed: true },
      ]
    );
    const next = acceptSelectedProposals(doc, new Set(['new']));
    expect(next.edges.find((edge) => edge.id === 'e-existing')?.proposed).toBe(true);
    expect(next.edges.find((edge) => edge.id === 'e-new')?.proposed).toBeUndefined();
  });

  it('accepts an empty selection as "accept nothing", not "accept everything"', () => {
    const doc = docWith([jobNode('a', true)], []);
    const next = acceptSelectedProposals(doc, new Set());
    expect(next.nodes[0]?.proposed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { ancestors, cycleIfAdded, findCycle, pathBetween } from './dag';

const e = (from: string, to: string) => ({ from, to });

function isCyclePath(path: string[], edges: Array<{ from: string; to: string }>): boolean {
  if (path.length < 2 || path[0] !== path[path.length - 1]) return false;
  return path
    .slice(1)
    .every((to, i) => edges.some((edge) => edge.from === path[i] && edge.to === to));
}

describe('findCycle', () => {
  it('returns null for a DAG', () => {
    expect(
      findCycle(['a', 'b', 'c', 'd'], [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')])
    ).toBeNull();
  });

  it('returns null for an empty graph and isolated nodes', () => {
    expect(findCycle([], [])).toBeNull();
    expect(findCycle(['a', 'b'], [])).toBeNull();
  });

  it('returns the cycle path, first node repeated at the end', () => {
    const edges = [e('x', 'a'), e('a', 'b'), e('b', 'c'), e('c', 'a')];
    const cycle = findCycle(['x', 'a', 'b', 'c'], edges)!;
    expect(cycle).toEqual(['a', 'b', 'c', 'a']);
    expect(isCyclePath(cycle, edges)).toBe(true);
  });

  it('detects a self loop', () => {
    expect(findCycle(['a'], [e('a', 'a')])).toEqual(['a', 'a']);
  });

  it('handles nodes only mentioned in edges and long chains without recursion', () => {
    const edges = Array.from({ length: 20_000 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    expect(findCycle([], edges)).toBeNull();
    edges.push(e('n20000', 'n0'));
    expect(findCycle([], edges)).toHaveLength(20_002);
  });
});

describe('cycleIfAdded', () => {
  const edges = [e('a', 'b'), e('b', 'c')];

  it('reports the cycle a new edge would close', () => {
    expect(cycleIfAdded(edges, 'c', 'a')).toEqual(['c', 'a', 'b', 'c']);
  });

  it('returns null when the edge is safe', () => {
    expect(cycleIfAdded(edges, 'a', 'c')).toBeNull();
  });

  it('rejects self edges', () => {
    expect(cycleIfAdded(edges, 'a', 'a')).toEqual(['a', 'a']);
  });
});

describe('pathBetween and ancestors', () => {
  const edges = [e('a', 'b'), e('b', 'c'), e('x', 'c'), e('c', 'd')];

  it('finds a directed path', () => {
    expect(pathBetween(edges, 'a', 'd')).toEqual(['a', 'b', 'c', 'd']);
    expect(pathBetween(edges, 'd', 'a')).toBeNull();
    expect(pathBetween(edges, 'a', 'a')).toEqual(['a']);
  });

  it('collects the whole dependency chain', () => {
    expect([...ancestors(edges, 'd')].sort()).toEqual(['a', 'b', 'c', 'x']);
    expect(ancestors(edges, 'a').size).toBe(0);
  });
});

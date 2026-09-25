import { describe, expect, it } from 'vitest';
import { orderByRecency } from './project-fallback';

const p = (projectId: string) => ({ projectId, name: projectId });

describe('orderByRecency', () => {
  // The Brain drawer starts a session in the first project it is handed, so this ordering is the
  // whole of "a new Brain opens on the project you were last working in".
  it('puts the most recently visited project first', () => {
    const ordered = orderByRecency([p('alpha'), p('beta'), p('gamma')], ['gamma', 'alpha']);
    expect(ordered.map((row) => row.projectId)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('keeps never-visited projects last, in their original order', () => {
    const ordered = orderByRecency([p('alpha'), p('beta'), p('gamma')], ['beta']);
    expect(ordered.map((row) => row.projectId)).toEqual(['beta', 'alpha', 'gamma']);
  });

  it('leaves the order alone when nothing has been visited', () => {
    const ordered = orderByRecency([p('alpha'), p('beta')], []);
    expect(ordered.map((row) => row.projectId)).toEqual(['alpha', 'beta']);
  });

  it('ignores recent ids for projects that are no longer open', () => {
    const ordered = orderByRecency([p('alpha')], ['closed', 'alpha']);
    expect(ordered.map((row) => row.projectId)).toEqual(['alpha']);
  });

  it('does not mutate the projects it was given', () => {
    const projects = [p('alpha'), p('beta')];
    orderByRecency(projects, ['beta']);
    expect(projects.map((row) => row.projectId)).toEqual(['alpha', 'beta']);
  });
});

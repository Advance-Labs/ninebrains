import {
  asAvailableProject,
  getProjectManagerStore,
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getNavigationHistory } from '@core/primitives/navigation/browser/navigation-selectors';

export type FallbackProject = { projectId: string; name: string };

/**
 * Orders projects by how recently each was visited, most recent first; anything never visited
 * keeps its original relative position at the end.
 *
 * A Brain session belongs to one project, and the drawer starts one in the first project it is
 * handed. "The project that was going on" is the one the user was last actually in, so the
 * ordering — not just the membership — of this list is what decides where a Brain starts.
 */
export function orderByRecency<T extends { projectId: string }>(
  projects: readonly T[],
  recentProjectIds: readonly string[]
): T[] {
  const rank = new Map(recentProjectIds.map((projectId, index) => [projectId, index]));
  return [...projects].sort(
    (a, b) =>
      (rank.get(a.projectId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.projectId) ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Project ids in most-recently-visited order. Walks back from where the user stands now rather
 * than over the whole array: entries past `index` are forward history, places they left rather
 * than places they returned to.
 */
export function recentlyVisitedProjectIds(): string[] {
  const history = getNavigationHistory();
  const seen: string[] = [];
  for (let i = Math.min(history.index, history.entries.length - 1); i >= 0; i--) {
    const projectId = history.entries[i]?.ref.params.projectId;
    if (typeof projectId === 'string' && projectId.length > 0 && !seen.includes(projectId)) {
      seen.push(projectId);
    }
  }
  return seen;
}

/**
 * Every open, available project, most recently visited first — the Brain drawer's fallback when
 * no lane has named one.
 */
export function openProjects(): FallbackProject[] {
  const rows: FallbackProject[] = [];
  for (const [projectId] of getProjectManagerStore().projects) {
    if (!asAvailableProject(getProjectStore(projectId))) continue;
    rows.push({
      projectId,
      name: projectDisplayName(getProjectStore(projectId)) ?? 'Untitled project',
    });
  }
  return orderByRecency(rows, recentlyVisitedProjectIds());
}

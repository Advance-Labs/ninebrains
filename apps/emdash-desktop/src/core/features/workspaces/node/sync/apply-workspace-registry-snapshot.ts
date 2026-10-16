import { isDeepStrictEqual } from 'node:util';
import type { WorkspaceRecords } from '@emdash/core/runtimes/workspace-registry/api';
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
  createWorkspaceRegistry,
  isAnnotatedWorkspace,
  liveWorkspaces,
  workspaceObservationFromRecord,
  workspaceRegistryTable as workspaces,
  type WorkspaceHostIdentity,
  type WorkspaceObservation,
  type WorkspaceRegistry,
} from '@core/features/workspaces/api/node/registry';
import {
  stableWorkspacePathDisplay,
  workspacePathIdentityKey,
} from '@core/features/workspaces/api/workspace-path-identity';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { type WorkspaceRow } from '@core/services/app-db/node/schema';
import { loadWorkspaceAnnotations } from './workspace-annotations';

export interface ApplyWorkspaceRegistrySnapshotInput {
  db: AppDb;
  host: WorkspaceHostIdentity;
  records: WorkspaceRecords;
  /** Epoch-ms observation stamp; defaults to now. */
  observedAt?: number;
}

export interface ApplyWorkspaceRegistrySnapshotResult {
  adopted: number;
  refreshed: number;
  markedMissing: number;
  untracked: number;
  /** Tombstoned rows whose host record this delivery confirmed gone (ADR 0006). */
  purgedTombstones: number;
}

export class WorkspaceIdentityConflictError extends Error {
  readonly name = 'WorkspaceIdentityConflictError';

  constructor(
    readonly host: WorkspaceHostIdentity,
    readonly path: string,
    readonly incomingId: string,
    readonly conflictingId: string
  ) {
    super(
      `Workspace identity conflict at '${path}': Host delivered '${incomingId}', desktop has '${conflictingId}'`
    );
  }

  fingerprint(): string {
    return [
      this.host.location,
      this.host.sshConnectionId ?? 'local',
      workspacePathIdentityKey(this.path),
      this.incomingId,
      this.conflictingId,
    ].join('\u0000');
  }
}

/**
 * Converges the desktop workspace mirror toward one host's registry (ADR 0005): every
 * `records` delivery applies as a single idempotent transaction through the registry
 * sole-writer verbs — refresh matches by id, adopt unknowns, sweep unmatched rows
 * through the missing rules. Observations (the git block, create outcome, runtime
 * overlay included) overwrite wholesale; annotations are never touched. Callers must
 * only invoke this after a successful read: an unreachable host sweeps nothing.
 */
export async function applyWorkspaceRegistrySnapshot(
  input: ApplyWorkspaceRegistrySnapshotInput
): Promise<ApplyWorkspaceRegistrySnapshotResult> {
  const now = new Date().toISOString();
  const registry = createWorkspaceRegistry(input.db, { now: () => now });
  const { counts, wrote } = input.db.transaction((tx) =>
    applyWorkspaceRegistrySnapshotTx(tx, input, registry, now)
  );
  // The host re-delivers an identical snapshot every scan tick; poking on a no-op delivery
  // made every renderer workspace query re-run every ~2s for nothing.
  if (wrote) appDbPokes.workspaces.poke({});
  return counts;
}

/**
 * An unchanged row's observation stamp is bumped at most this often. The only reader of a
 * row's stamp as wall time is the minute-granular "Synced … ago" label.
 */
const OBSERVED_AT_TOUCH_INTERVAL_MS = 30_000;

function applyWorkspaceRegistrySnapshotTx(
  tx: DrizzleTx,
  input: ApplyWorkspaceRegistrySnapshotInput,
  registry: WorkspaceRegistry,
  now: string
): { counts: ApplyWorkspaceRegistrySnapshotResult; wrote: boolean } {
  const observedAt = input.observedAt ?? Date.now();
  const hostRows = loadLiveHostRows(tx, input.host);
  const annotations = loadWorkspaceAnnotations(
    tx,
    hostRows.map((row) => row.id)
  );
  assertNoIdentityConflicts(input.host, hostRows, input.records);
  releaseMovedPaths(tx, hostRows, input.records);
  const counts: ApplyWorkspaceRegistrySnapshotResult = {
    adopted: 0,
    refreshed: 0,
    markedMissing: 0,
    untracked: 0,
    purgedTombstones: 0,
  };

  const tombstoned = loadTombstonedIds(
    tx,
    Object.values(input.records).map((record) => record.id)
  );
  const rowById = new Map(hostRows.map((row) => [row.id, row]));
  const unchangedIds: string[] = [];
  let wrote = false;
  const seen = new Set<string>();
  for (const record of Object.values(input.records)) {
    seen.add(record.id);
    // Desktop untracking is durable: a delivery never resurrects a tombstoned row.
    if (tombstoned.has(record.id)) continue;
    // Matching is a primary-key lookup on the preserved workspace UUID — the host
    // already resolved moves and adoptions; no path or admin-name matching here.
    const existing = rowById.get(record.id) ?? registry.getLive(record.id, tx);
    if (existing === undefined) {
      registry.adopt(
        {
          id: record.id,
          type: input.host.location === 'remote' ? 'project-ssh' : 'local',
          ...workspaceObservationFromRecord(record, input.host, observedAt),
          createdAt: new Date(record.createdAt).toISOString(),
        },
        tx
      );
      counts.adopted += 1;
      wrote = true;
      continue;
    }
    const observation = workspaceObservationFromRecord(record, input.host, observedAt);
    if (observationUnchanged(existing, observation)) {
      unchangedIds.push(record.id);
    } else {
      registry.refresh(record.id, observation, tx);
      wrote = true;
    }
    counts.refreshed += 1;
  }

  for (const row of hostRows) {
    if (seen.has(row.id)) continue;
    // Purge-on-mirror-confirmed-gone (ADR 0006): the delivery is the host's full
    // snapshot, so a live tombstoned row absent from it has converged — the pending
    // deletion completed (or the record never existed). The untrack is the purge;
    // annotation never keeps a row the user already deleted visible as missing.
    if (row.deletionTombstone !== null) {
      registry.untrack([row.id], now, undefined, tx);
      counts.purgedTombstones += 1;
      wrote = true;
      continue;
    }
    const annotated = isAnnotatedWorkspace({
      config: row.config,
      hasTaskLink: annotations.taskWorkspaceIds.has(row.id),
      isProjectRepository: annotations.projectRepositoryWorkspaceIds.has(row.id),
    });
    if (annotated) {
      // Annotated rows stay visible as missing until the user acts.
      if (row.observedStatus === 'missing') {
        unchangedIds.push(row.id);
      } else {
        registry.refresh(row.id, { observedStatus: 'missing', observedAt }, tx);
        wrote = true;
      }
      counts.markedMissing += 1;
    } else {
      // Pure mirror entries follow the mirror.
      registry.untrack([row.id], now, undefined, tx);
      counts.untracked += 1;
      wrote = true;
    }
  }

  if (touchObservedAt(tx, unchangedIds, observedAt) > 0) wrote = true;
  return { counts, wrote };
}

/** True when refreshing `row` with `observation` would change nothing but the stamp. */
function observationUnchanged(row: WorkspaceRow, observation: WorkspaceObservation): boolean {
  return Object.entries(observation).every(([key, value]) => {
    if (key === 'observedAt') return true;
    if (key === 'path') {
      // Mirrors refresh: a same-identity spelling change keeps the stored display path.
      return (
        typeof value === 'string' &&
        row.path !== null &&
        stableWorkspacePathDisplay(row.path, value) === row.path
      );
    }
    return isDeepStrictEqual(asStored(row[key as keyof WorkspaceRow]), asStored(value));
  });
}

/** JSON columns drop undefined keys on write, so compare values the way they persist. */
function asStored(value: unknown): unknown {
  return value === undefined || value === null ? null : JSON.parse(JSON.stringify(value));
}

function touchObservedAt(tx: DrizzleTx, ids: string[], observedAt: number): number {
  if (ids.length === 0) return 0;
  return tx
    .update(workspaces)
    .set({ observedAt })
    .where(
      and(
        inArray(workspaces.id, ids),
        or(
          isNull(workspaces.observedAt),
          lt(workspaces.observedAt, observedAt - OBSERVED_AT_TOUCH_INTERVAL_MS)
        )
      )
    )
    .run().changes;
}

/**
 * A full snapshot may contain a valid path swap, or move a known record away before
 * an unknown record takes its old path. Release all moved paths as one first phase so
 * SQLite's live-path unique index cannot make the outcome depend on record order.
 * The surrounding transaction restores every path if a later write fails.
 */
function releaseMovedPaths(
  tx: DrizzleTx,
  rows: readonly WorkspaceRow[],
  records: WorkspaceRecords
): void {
  const incomingPathById = new Map(
    Object.values(records).map((record) => [record.id, record.path])
  );
  const movedIds = rows.flatMap((row) => {
    const incomingPath = incomingPathById.get(row.id);
    return incomingPath !== undefined &&
      (row.path === null ||
        workspacePathIdentityKey(incomingPath) !== workspacePathIdentityKey(row.path))
      ? [row.id]
      : [];
  });
  if (movedIds.length === 0) return;
  tx.update(workspaces).set({ path: null }).where(inArray(workspaces.id, movedIds)).run();
}

function loadLiveHostRows(tx: DrizzleTx, host: WorkspaceHostIdentity): WorkspaceRow[] {
  const hostIdentity =
    host.sshConnectionId === null
      ? isNull(workspaces.sshConnectionId)
      : eq(workspaces.sshConnectionId, host.sshConnectionId);
  return tx
    .select()
    .from(workspaces)
    .where(and(liveWorkspaces(), eq(workspaces.location, host.location), hostIdentity))
    .all();
}

function loadTombstonedIds(tx: DrizzleTx, recordIds: string[]): Set<string> {
  if (recordIds.length === 0) return new Set();
  const rows = tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(inArray(workspaces.id, recordIds), isNotNull(workspaces.untrackedAt)))
    .all();
  return new Set(rows.map((row) => row.id));
}

function assertNoIdentityConflicts(
  host: WorkspaceHostIdentity,
  rows: readonly WorkspaceRow[],
  records: WorkspaceRecords
): void {
  const ownerByPath = new Map<string, string>();
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.path !== null) ownerByPath.set(workspacePathIdentityKey(row.path), row.id);
  }
  // A known id may legitimately move. Release its old observed path in the
  // preflight model before checking the full incoming assignment.
  for (const record of Object.values(records)) {
    const previous = rowById.get(record.id);
    if (previous?.path) {
      const previousKey = workspacePathIdentityKey(previous.path);
      if (ownerByPath.get(previousKey) === record.id) ownerByPath.delete(previousKey);
    }
  }
  for (const record of Object.values(records)) {
    const pathKey = workspacePathIdentityKey(record.path);
    const conflictingId = ownerByPath.get(pathKey);
    if (conflictingId !== undefined && conflictingId !== record.id) {
      throw new WorkspaceIdentityConflictError(host, record.path, record.id, conflictingId);
    }
    ownerByPath.set(pathKey, record.id);
  }
}

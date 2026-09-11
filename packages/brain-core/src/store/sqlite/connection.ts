import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

export interface SqliteRunResultLike {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

/**
 * The SQL surface `SqliteBrainStore` needs. Structurally identical to
 * `SqliteConnection` from `@emdash/core/primitives/sqlite-store`, so a
 * connection opened by core's `defineDurableSqliteStore` (better-sqlite3 in
 * the Electron main process) plugs in unchanged. brain-core does not import
 * core; the shapes simply match.
 */
export interface SqliteConnectionLike {
  readonly native: unknown;
  exec(sql: string): void;
  get<T>(sql: string, params?: readonly unknown[]): T | undefined;
  all<T>(sql: string, params?: readonly unknown[]): T[];
  run(sql: string, params?: readonly unknown[]): SqliteRunResultLike;
  close(): void;
}

const requireBuiltin = createRequire(import.meta.url);

/**
 * Opens a `node:sqlite` connection. Built into Node >= 22.13 and Electron
 * >= 35, so there is no native addon and no ABI to match. The module is
 * loaded on first open, not at import, so importing brain-core stays cheap
 * and a host can filter node:sqlite's experimental warning first.
 */
export function openNodeSqliteConnection(
  file: string,
  options: { busyTimeoutMs?: number } = {}
): SqliteConnectionLike {
  const { DatabaseSync: Database } = requireBuiltin('node:sqlite') as {
    DatabaseSync: typeof DatabaseSync;
  };
  const db = new Database(file, { timeout: options.busyTimeoutMs ?? 10_000 });
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };
  const bind = (params: readonly unknown[] = []) => params as SQLInputValue[];

  return {
    native: db,
    exec: (sql) => db.exec(sql),
    get: <T>(sql: string, params?: readonly unknown[]) =>
      prepare(sql).get(...bind(params)) as T | undefined,
    all: <T>(sql: string, params?: readonly unknown[]) => prepare(sql).all(...bind(params)) as T[],
    run: (sql, params) => prepare(sql).run(...bind(params)),
    close: () => {
      statements.clear();
      if (db.isOpen) db.close();
    },
  };
}

/** A `SqliteDriver` for core's store primitive, backed by node:sqlite. */
export const nodeSqliteDriver = {
  open: (file: string) => openNodeSqliteConnection(file),
};

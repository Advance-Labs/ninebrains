import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  betterSqlite3Driver,
  defineDurableSqliteStore,
} from '@emdash/core/primitives/sqlite-store/node';
import {
  BRAIN_BUNDLED_MIGRATIONS,
  SqliteBrainStore,
  type SqliteConnectionLike,
} from '@ninebrains/brain-core';

export const BRAIN_DB_FILENAME = 'ninebrains-brain.db';

const brainStoreDefinition = defineDurableSqliteStore({
  name: 'brain',
  driver: betterSqlite3Driver,
  migrations: BRAIN_BUNDLED_MIGRATIONS,
});

export interface OpenedBrainStore {
  store: SqliteBrainStore;
  /** The same connection, for Ninebrains tables outside brain-core's store (`model_profiles`). */
  connection: SqliteConnectionLike;
  close(): void;
}

/**
 * SEC-01: main is the only process that opens the Brain DB. The directory is
 * created 0700 and the file 0600 before SQLite touches it, so the WAL and SHM
 * siblings inherit a private directory. The path is injected from app/main
 * (core may not call `app.getPath`).
 */
export function openBrainStore(path: string): OpenedBrainStore {
  ensurePrivateDbFile(path);
  const handle = brainStoreDefinition.open(path);
  const connection = handle.connection as unknown as SqliteConnectionLike;
  const store = SqliteBrainStore.fromConnection(connection, { path });
  return { store, connection, close: () => handle.close() };
}

export function ensurePrivateDbFile(path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
  if (process.platform !== 'win32') chmodSync(path, 0o600);
}

import type { SqliteConnectionLike } from '@ninebrains/brain-core';
import {
  baseUrlProblem,
  modelProfileSchema,
  tierModelsSchema,
  type ModelProfile,
  type TierModels,
} from '../api/profile';
import { vendorProblem } from './vendors';

/**
 * The Brain DB's `model_profiles` table (brain-core migration 3). The key lives in the keychain
 * as `ninebrains.model.<id>`; this table only records whether one is set (SEC-40).
 */
export type StoredProfile = ModelProfile & { hasKey: boolean };

type Row = {
  id: string;
  label: string;
  kind: string;
  vendor_id: string | null;
  protocol: string;
  base_url: string;
  model: string | null;
  tier_models: string;
  tier: string;
  price_in_per_mtok: number | null;
  price_out_per_mtok: number | null;
  price_cache_read_per_mtok: number | null;
  price_cache_write_per_mtok: number | null;
  context_window: number | null;
  enabled: number;
  has_key: number;
  created_at: number;
  updated_at: number;
};

export interface ProfilesRepo {
  list(): StoredProfile[];
  get(id: string): StoredProfile | undefined;
  insert(profile: StoredProfile): void;
  /** Updates everything but `hasKey` and `createdAt`. */
  update(profile: ModelProfile): void;
  setHasKey(id: string, hasKey: boolean, at: number): void;
  delete(id: string): void;
}

function parseTiers(raw: string): TierModels {
  try {
    const parsed = tierModelsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * A row that fails validation, the base-URL rules or the vendor allowlist (edited by hand, or
 * written by an older build) is skipped: to the app it does not exist, so it can never launch.
 */
function fromRow(row: Row): StoredProfile | undefined {
  const parsed = modelProfileSchema.safeParse({
    id: row.id,
    label: row.label,
    kind: row.kind,
    vendorId: row.vendor_id,
    protocol: row.protocol,
    baseUrl: row.base_url,
    ...(row.model ? { model: row.model } : {}),
    tierModels: parseTiers(row.tier_models),
    tier: row.tier,
    price: {
      inPerMTok: row.price_in_per_mtok,
      outPerMTok: row.price_out_per_mtok,
      cacheReadPerMTok: row.price_cache_read_per_mtok,
      cacheWritePerMTok: row.price_cache_write_per_mtok,
    },
    contextWindow: row.context_window === null ? null : Number(row.context_window),
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
  if (!parsed.success) return undefined;
  const profile = parsed.data;
  if (baseUrlProblem(profile.baseUrl, profile.kind) || vendorProblem(profile)) return undefined;
  return { ...profile, hasKey: Number(row.has_key) === 1 };
}

const COLUMNS = [
  'id',
  'label',
  'kind',
  'vendor_id',
  'protocol',
  'base_url',
  'model',
  'tier_models',
  'tier',
  'price_in_per_mtok',
  'price_out_per_mtok',
  'price_cache_read_per_mtok',
  'price_cache_write_per_mtok',
  'context_window',
  'enabled',
  'has_key',
  'created_at',
  'updated_at',
];

function values(profile: ModelProfile): unknown[] {
  return [
    profile.label,
    profile.kind,
    profile.vendorId,
    profile.protocol,
    profile.baseUrl,
    profile.model ?? null,
    JSON.stringify(profile.tierModels),
    profile.tier,
    profile.price.inPerMTok,
    profile.price.outPerMTok,
    profile.price.cacheReadPerMTok,
    profile.price.cacheWritePerMTok,
    profile.contextWindow,
    profile.enabled ? 1 : 0,
  ];
}

export function createProfilesRepo(connection: SqliteConnectionLike): ProfilesRepo {
  const select = `SELECT ${COLUMNS.join(', ')} FROM model_profiles`;
  return {
    list: () =>
      connection.all<Row>(`${select} ORDER BY created_at, id`).flatMap((row) => fromRow(row) ?? []),
    get: (id) => {
      const row = connection.get<Row>(`${select} WHERE id = ?`, [id]);
      return row ? fromRow(row) : undefined;
    },
    insert: (profile) => {
      connection.run(
        `INSERT INTO model_profiles (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
        [
          profile.id,
          ...values(profile),
          profile.hasKey ? 1 : 0,
          profile.createdAt,
          profile.updatedAt,
        ]
      );
    },
    update: (profile) => {
      const set = COLUMNS.slice(1, 15)
        .map((column) => `${column} = ?`)
        .join(', ');
      connection.run(`UPDATE model_profiles SET ${set}, updated_at = ? WHERE id = ?`, [
        ...values(profile),
        profile.updatedAt,
        profile.id,
      ]);
    },
    setHasKey: (id, hasKey, at) => {
      connection.run('UPDATE model_profiles SET has_key = ?, updated_at = ? WHERE id = ?', [
        hasKey ? 1 : 0,
        at,
        id,
      ]);
    },
    delete: (id) => {
      connection.run('DELETE FROM model_profiles WHERE id = ?', [id]);
    },
  };
}

/** The same interface over a Map, for tests and the disabled service. */
export function createMemoryProfilesRepo(): ProfilesRepo {
  const rows = new Map<string, StoredProfile>();
  return {
    list: () => [...rows.values()].map((p) => structuredClone(p)),
    get: (id) => {
      const found = rows.get(id);
      return found ? structuredClone(found) : undefined;
    },
    insert: (profile) => void rows.set(profile.id, structuredClone(profile)),
    update: (profile) => {
      const existing = rows.get(profile.id);
      if (existing) {
        rows.set(profile.id, {
          ...structuredClone(profile),
          hasKey: existing.hasKey,
          createdAt: existing.createdAt,
        });
      }
    },
    setHasKey: (id, hasKey, at) => {
      const existing = rows.get(id);
      if (existing) rows.set(id, { ...existing, hasKey, updatedAt: at });
    },
    delete: (id) => void rows.delete(id),
  };
}

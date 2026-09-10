import path from 'node:path';
import { type BrainGrant, type Identity, assertLoopbackUrl, resolveBrainDbPath } from '@ninebrains/brain-core';

export type Role = 'lane' | 'brain';

/**
 * forward (default): a thin shim. Each tool call is POSTed to the app's main
 * process, which owns the DB and decides identity from the token.
 * direct: opens the Brain SQLite file itself; identity comes from env. For
 * tests and headless use only, so it must be asked for explicitly.
 */
export type BrainMcpConfig =
  | { mode: 'forward'; role: Role; url: string; token: string }
  | { mode: 'direct'; role: Role; dbPath: string; grant: BrainGrant };

export const ENV = {
  mode: 'NINEBRAINS_MODE',
  role: 'NINEBRAINS_ROLE',
  url: 'NINEBRAINS_BRAIN_URL',
  token: 'NINEBRAINS_TOKEN',
  laneId: 'NINEBRAINS_LANE_ID',
  brainId: 'NINEBRAINS_BRAIN_ID',
  projectId: 'NINEBRAINS_PROJECT_ID',
  db: 'NINEBRAINS_BRAIN_DB',
  projectDir: 'NINEBRAINS_PROJECT_DIR',
  evidenceDir: 'NINEBRAINS_EVIDENCE_DIR',
} as const;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrainMcpConfig {
  const role = env[ENV.role] || 'lane';
  if (role !== 'lane' && role !== 'brain') throw new ConfigError(`${ENV.role} must be "lane" or "brain", got "${role}"`);
  const mode = env[ENV.mode] || 'forward';
  if (mode === 'forward') return forwardConfig(env, role);
  if (mode === 'direct') return directConfig(env, role);
  throw new ConfigError(`${ENV.mode} must be "forward" or "direct", got "${mode}"`);
}

function forwardConfig(env: NodeJS.ProcessEnv, role: Role): BrainMcpConfig {
  const url = env[ENV.url];
  const token = env[ENV.token];
  if (!url) {
    throw new ConfigError(
      `${ENV.url} is required (the app sets it). For a standalone DB, set ${ENV.mode}=direct and ${ENV.db}.`
    );
  }
  try {
    assertLoopbackUrl(url);
  } catch (error) {
    throw new ConfigError((error as Error).message);
  }
  if (!token || token.length > 512) throw new ConfigError(`${ENV.token} is required in forward mode`);
  return { mode: 'forward', role, url, token };
}

function directConfig(env: NodeJS.ProcessEnv, role: Role): BrainMcpConfig {
  const db = env[ENV.db];
  if (!db) throw new ConfigError(`${ENV.db} is required in direct mode (a brain.sqlite path or its directory)`);
  if (!path.isAbsolute(db)) throw new ConfigError(`${ENV.db} must be an absolute path`);

  const projectId = optionalId(env, ENV.projectId);
  const attachmentRoots = [env[ENV.projectDir], env[ENV.evidenceDir]]
    .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
    .map((dir) => {
      if (!path.isAbsolute(dir)) throw new ConfigError(`attachment root ${dir} must be an absolute path`);
      return path.resolve(dir);
    });

  let identity: Identity;
  if (role === 'lane') {
    const laneId = optionalId(env, ENV.laneId);
    if (!laneId) throw new ConfigError(`${ENV.laneId} is required for role "lane"`);
    if (!projectId) throw new ConfigError(`${ENV.projectId} is required for role "lane"`);
    identity = { role: 'lane', laneId, projectId };
  } else {
    identity = { role: 'brain', brainId: optionalId(env, ENV.brainId) ?? 'main' };
  }
  return { mode: 'direct', role, dbPath: resolveBrainDbPath(db), grant: { identity, projectId, attachmentRoots } };
}

function optionalId(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined || value === '') return null;
  if (!ID.test(value)) throw new ConfigError(`${name} must match ${ID.source}`);
  return value;
}

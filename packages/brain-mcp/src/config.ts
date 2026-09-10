import path from 'node:path';
import { type Identity, resolveBrainDbPath } from '@ninebrains/brain-core';

/**
 * The server's identity comes only from its spawn environment, never from
 * tool arguments, so an agent cannot act as another lane.
 */
export interface BrainMcpConfig {
  identity: Identity;
  /** Default project for brain-role calls that omit one. Always set for lanes. */
  projectId: string | null;
  dbPath: string;
  /** Attachments and artifacts must resolve inside one of these directories. */
  attachmentRoots: string[];
}

export const ENV = {
  role: 'NINEBRAINS_ROLE',
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
  const role = env[ENV.role] ?? 'lane';
  if (role !== 'lane' && role !== 'brain') throw new ConfigError(`${ENV.role} must be "lane" or "brain", got "${role}"`);

  const db = env[ENV.db];
  if (!db) throw new ConfigError(`${ENV.db} is required (a brain.sqlite path or the directory holding it)`);
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

  return { identity, projectId, dbPath: resolveBrainDbPath(db), attachmentRoots };
}

function optionalId(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined || value === '') return null;
  if (!ID.test(value)) throw new ConfigError(`${name} must match ${ID.source}`);
  return value;
}

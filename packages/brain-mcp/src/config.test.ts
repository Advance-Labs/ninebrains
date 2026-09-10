import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { brainMcpServerEntry } from './launch';

const base = { NINEBRAINS_BRAIN_DB: '/data/ninebrains' };

describe('loadConfig', () => {
  it('builds a lane identity from env and resolves the db directory', () => {
    const config = loadConfig({
      ...base,
      NINEBRAINS_ROLE: 'lane',
      NINEBRAINS_LANE_ID: 'lane-1',
      NINEBRAINS_PROJECT_ID: 'proj',
      NINEBRAINS_PROJECT_DIR: '/work/proj',
      NINEBRAINS_EVIDENCE_DIR: '/data/evidence',
    });
    expect(config).toEqual({
      identity: { role: 'lane', laneId: 'lane-1', projectId: 'proj' },
      projectId: 'proj',
      dbPath: path.join('/data/ninebrains', 'brain.sqlite'),
      attachmentRoots: ['/work/proj', '/data/evidence'],
    });
  });

  it('defaults the role to lane and the brain id to main', () => {
    expect(loadConfig({ ...base, NINEBRAINS_LANE_ID: 'a', NINEBRAINS_PROJECT_ID: 'p' }).identity.role).toBe('lane');
    expect(loadConfig({ ...base, NINEBRAINS_ROLE: 'brain' })).toMatchObject({
      identity: { role: 'brain', brainId: 'main' },
      projectId: null,
      attachmentRoots: [],
    });
    expect(loadConfig({ ...base, NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_ID: 'b2' }).identity).toEqual({
      role: 'brain',
      brainId: 'b2',
    });
  });

  it('keeps an explicit db file path', () => {
    expect(loadConfig({ NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_DB: '/x/custom.db' }).dbPath).toBe('/x/custom.db');
  });

  it.each([
    [{}, /NINEBRAINS_BRAIN_DB is required/],
    [{ NINEBRAINS_BRAIN_DB: 'relative/db' }, /absolute/],
    [{ ...base, NINEBRAINS_ROLE: 'admin' }, /"lane" or "brain"/],
    [{ ...base, NINEBRAINS_PROJECT_ID: 'p' }, /NINEBRAINS_LANE_ID is required/],
    [{ ...base, NINEBRAINS_LANE_ID: 'a' }, /NINEBRAINS_PROJECT_ID is required/],
    [{ ...base, NINEBRAINS_LANE_ID: 'a b', NINEBRAINS_PROJECT_ID: 'p' }, /NINEBRAINS_LANE_ID must match/],
    [{ ...base, NINEBRAINS_ROLE: 'brain', NINEBRAINS_PROJECT_DIR: 'rel' }, /absolute/],
  ])('rejects bad env %#', (env, message) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(message);
  });
});

describe('brainMcpServerEntry', () => {
  it('runs the bin through Electron as Node, identity in env only', () => {
    expect(
      brainMcpServerEntry({
        binPath: '/app/brain-mcp/bin.mjs',
        runtime: { kind: 'electron', execPath: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains' },
        role: 'lane',
        dbPath: '/data/brain.sqlite',
        projectId: 'proj',
        laneId: 'lane-1',
        projectDir: '/work/proj',
        evidenceDir: '/data/evidence',
      })
    ).toEqual({
      type: 'stdio',
      command: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains',
      args: ['/app/brain-mcp/bin.mjs'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NINEBRAINS_ROLE: 'lane',
        NINEBRAINS_BRAIN_DB: '/data/brain.sqlite',
        NINEBRAINS_PROJECT_ID: 'proj',
        NINEBRAINS_LANE_ID: 'lane-1',
        NINEBRAINS_PROJECT_DIR: '/work/proj',
        NINEBRAINS_EVIDENCE_DIR: '/data/evidence',
      },
    });
  });

  it('omits ELECTRON_RUN_AS_NODE for a plain node runtime', () => {
    const entry = brainMcpServerEntry({
      binPath: '/b.mjs',
      runtime: { kind: 'node', execPath: '/usr/bin/node' },
      role: 'brain',
      dbPath: '/d',
      brainId: 'b1',
    });
    expect(entry.env).toEqual({ NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_DB: '/d', NINEBRAINS_BRAIN_ID: 'b1' });
  });
});

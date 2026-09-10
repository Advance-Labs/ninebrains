import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { brainMcpServerEntry } from './launch';

const direct = { NINEBRAINS_MODE: 'direct', NINEBRAINS_BRAIN_DB: '/data/ninebrains' };

describe('loadConfig: forward mode (default)', () => {
  it('needs only the URL and token; identity is decided by the app', () => {
    expect(
      loadConfig({ NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:4100', NINEBRAINS_TOKEN: 'tok', NINEBRAINS_LANE_ID: 'A' })
    ).toEqual({ mode: 'forward', role: 'lane', url: 'http://127.0.0.1:4100', token: 'tok' });
    expect(
      loadConfig({ NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_URL: 'http://localhost:1', NINEBRAINS_TOKEN: 't' }).role
    ).toBe('brain');
  });

  it.each([
    [{}, /NINEBRAINS_BRAIN_URL is required.*NINEBRAINS_MODE=direct/],
    [{ NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:1' }, /NINEBRAINS_TOKEN is required/],
    [{ NINEBRAINS_BRAIN_URL: 'https://brain.example.com', NINEBRAINS_TOKEN: 't' }, /loopback/],
    [{ NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:1', NINEBRAINS_TOKEN: 't', NINEBRAINS_MODE: 'turbo' }, /"forward" or "direct"/],
    [{ NINEBRAINS_ROLE: 'admin' }, /"lane" or "brain"/],
  ])('rejects bad env %#', (env, message) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(message);
  });
});

describe('loadConfig: direct mode (flagged)', () => {
  it('builds a lane grant from env and resolves the db directory', () => {
    expect(
      loadConfig({
        ...direct,
        NINEBRAINS_LANE_ID: 'lane-1',
        NINEBRAINS_PROJECT_ID: 'proj',
        NINEBRAINS_PROJECT_DIR: '/work/proj',
        NINEBRAINS_EVIDENCE_DIR: '/data/evidence',
      })
    ).toEqual({
      mode: 'direct',
      role: 'lane',
      dbPath: path.join('/data/ninebrains', 'brain.sqlite'),
      grant: {
        identity: { role: 'lane', laneId: 'lane-1', projectId: 'proj' },
        projectId: 'proj',
        attachmentRoots: ['/work/proj', '/data/evidence'],
      },
    });
  });

  it('defaults the brain id to main and keeps an explicit db file', () => {
    const config = loadConfig({ NINEBRAINS_MODE: 'direct', NINEBRAINS_ROLE: 'brain', NINEBRAINS_BRAIN_DB: '/x/custom.db' });
    expect(config).toMatchObject({ dbPath: '/x/custom.db', grant: { identity: { role: 'brain', brainId: 'main' } } });
  });

  it.each([
    [{ NINEBRAINS_MODE: 'direct' }, /NINEBRAINS_BRAIN_DB is required/],
    [{ NINEBRAINS_MODE: 'direct', NINEBRAINS_BRAIN_DB: 'rel/db' }, /absolute/],
    [{ ...direct, NINEBRAINS_PROJECT_ID: 'p' }, /NINEBRAINS_LANE_ID is required/],
    [{ ...direct, NINEBRAINS_LANE_ID: 'a' }, /NINEBRAINS_PROJECT_ID is required/],
    [{ ...direct, NINEBRAINS_LANE_ID: 'a b', NINEBRAINS_PROJECT_ID: 'p' }, /must match/],
    [{ ...direct, NINEBRAINS_ROLE: 'brain', NINEBRAINS_PROJECT_DIR: 'rel' }, /absolute/],
  ])('rejects bad env %#', (env, message) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(message);
  });
});

describe('brainMcpServerEntry', () => {
  it('forward mode: Electron as Node, URL + token in env', () => {
    expect(
      brainMcpServerEntry({
        mode: 'forward',
        binPath: '/app/brain-mcp/bin.mjs',
        runtime: { kind: 'electron', execPath: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains' },
        role: 'lane',
        url: 'http://127.0.0.1:4100',
        token: 'secret-token',
        laneId: 'lane-1',
      })
    ).toEqual({
      type: 'stdio',
      command: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains',
      args: ['/app/brain-mcp/bin.mjs'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NINEBRAINS_MODE: 'forward',
        NINEBRAINS_ROLE: 'lane',
        NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:4100',
        NINEBRAINS_TOKEN: 'secret-token',
        NINEBRAINS_LANE_ID: 'lane-1',
      },
    });
  });

  it('direct mode on plain node: no ELECTRON_RUN_AS_NODE, identity env', () => {
    const entry = brainMcpServerEntry({
      mode: 'direct',
      binPath: '/b.mjs',
      runtime: { kind: 'node', execPath: '/usr/bin/node' },
      role: 'brain',
      dbPath: '/d',
      brainId: 'b1',
    });
    expect(entry.env).toEqual({
      NINEBRAINS_MODE: 'direct',
      NINEBRAINS_ROLE: 'brain',
      NINEBRAINS_BRAIN_DB: '/d',
      NINEBRAINS_BRAIN_ID: 'b1',
    });
  });
});

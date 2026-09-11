import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { brainMcpServerEntry } from './launch';

const TOKEN = 'a'.repeat(43);
const base = { NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:4100', NINEBRAINS_TOKEN: TOKEN };

describe('loadConfig', () => {
  it('reads only the URL, the token and an optional lane hint', () => {
    expect(loadConfig(base)).toEqual({ url: 'http://127.0.0.1:4100', token: TOKEN, laneHint: null });
    expect(loadConfig({ ...base, NINEBRAINS_LANE_ID: 'lane-1' }).laneHint).toBe('lane-1');
  });

  it('SEC-01/SEC-02: role, mode and DB settings in env have no effect', () => {
    const config = loadConfig({
      ...base,
      NINEBRAINS_ROLE: 'brain',
      NINEBRAINS_MODE: 'direct',
      NINEBRAINS_BRAIN_DB: '/tmp/brain.sqlite',
      NINEBRAINS_PROJECT_ID: 'p1',
    });
    expect(config).toEqual({ url: 'http://127.0.0.1:4100', token: TOKEN, laneHint: null });
  });

  it('direct mode is not reachable through env: a DB path without a URL is still an error', () => {
    expect(() => loadConfig({ NINEBRAINS_MODE: 'direct', NINEBRAINS_BRAIN_DB: '/tmp/brain.sqlite' })).toThrow(
      /NINEBRAINS_BRAIN_URL is required/
    );
  });

  it.each([
    [{}, /NINEBRAINS_BRAIN_URL is required/],
    [{ NINEBRAINS_BRAIN_URL: 'http://localhost:4100', NINEBRAINS_TOKEN: TOKEN }, /127\.0\.0\.1/],
    [{ NINEBRAINS_BRAIN_URL: 'https://brain.example.com', NINEBRAINS_TOKEN: TOKEN }, /127\.0\.0\.1/],
    [{ NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:4100' }, /NINEBRAINS_TOKEN is missing or malformed/],
    [{ ...base, NINEBRAINS_TOKEN: 'short' }, /NINEBRAINS_TOKEN is missing or malformed/],
    [{ ...base, NINEBRAINS_LANE_ID: 'a:b' }, /NINEBRAINS_LANE_ID must be/],
    [{ ...base, NINEBRAINS_LANE_ID: '..' }, /NINEBRAINS_LANE_ID must be/],
  ])('rejects bad env %#', (env, message) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(message);
  });

  it('never echoes a malformed token', () => {
    const secretish = 'my-secret-token-with-a-typo!';
    try {
      loadConfig({ ...base, NINEBRAINS_TOKEN: secretish });
    } catch (error) {
      expect((error as Error).message).not.toContain(secretish);
    }
  });
});

describe('brainMcpServerEntry', () => {
  it('runs the bin through Electron as Node, with only URL, token and hint in env', () => {
    expect(
      brainMcpServerEntry({
        binPath: '/app/brain-mcp/bin.mjs',
        runtime: { kind: 'electron', execPath: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains' },
        url: 'http://127.0.0.1:4100',
        token: TOKEN,
        laneHint: 'lane-1',
      })
    ).toEqual({
      type: 'stdio',
      command: '/Applications/Ninebrains.app/Contents/MacOS/Ninebrains',
      args: ['/app/brain-mcp/bin.mjs'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:4100',
        NINEBRAINS_TOKEN: TOKEN,
        NINEBRAINS_LANE_ID: 'lane-1',
      },
    });
  });

  it('omits ELECTRON_RUN_AS_NODE and the hint when not needed', () => {
    const entry = brainMcpServerEntry({
      binPath: '/b.mjs',
      runtime: { kind: 'node', execPath: '/usr/bin/node' },
      url: 'http://127.0.0.1:1',
      token: TOKEN,
    });
    expect(entry.env).toEqual({ NINEBRAINS_BRAIN_URL: 'http://127.0.0.1:1', NINEBRAINS_TOKEN: TOKEN });
  });
});

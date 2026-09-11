import { describe, expect, it } from 'vitest';
import { buildScrubbedCommandEnv, buildUnattendedEnv } from './run-env';

const POLLUTED = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  LANG: 'en_CA.UTF-8',
  TMPDIR: '/tmp/x',
  HTTPS_PROXY: 'http://proxy:8080',
  GITHUB_TOKEN: 'ghp_x',
  GH_TOKEN: 'x',
  AWS_SECRET_ACCESS_KEY: 'x',
  GOOGLE_APPLICATION_CREDENTIALS: '/k.json',
  OPENAI_API_KEY: 'sk-x',
  ANTHROPIC_API_KEY: 'sk-ant-parent',
  CLAUDE_CONFIG_DIR: '/parent/claude',
  CODEX_HOME: '/parent/codex',
  NINEBRAINS_TOKEN: 'secret',
  NINEBRAINS_ROLE: 'brain',
  EMDASH_HOOK_TOKEN: 'x',
  CLAUDECODE: '1',
  CLAUDE_CODE_CHILD_SESSION: '1',
  VERCEL_TOKEN: 'x',
  STRIPE_SECRET_KEY: 'x',
};

describe('SEC-13 unattended env is minimal', () => {
  it('keeps only path, locale, home, temp and proxy, plus the chosen account', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'claude',
      auth: { CLAUDE_CONFIG_DIR: '/accounts/work' },
      platform: 'posix',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      LANG: 'en_CA.UTF-8',
      TMPDIR: '/tmp/x',
      HTTPS_PROXY: 'http://proxy:8080',
      CLAUDE_CONFIG_DIR: '/accounts/work',
      ENABLE_TOOL_SEARCH: 'false',
    });
  });

  it('never inherits the parent API key or account; only an explicit API-key choice passes', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'claude',
      auth: { ANTHROPIC_API_KEY: 'sk-ant-chosen' },
      platform: 'posix',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-chosen');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('gives codex runs CODEX_HOME and nothing Claude-specific', () => {
    const env = buildUnattendedEnv(POLLUTED, {
      provider: 'codex',
      auth: { CODEX_HOME: '/accounts/codex' },
      platform: 'posix',
    });
    expect(env.CODEX_HOME).toBe('/accounts/codex');
    expect(env.ENABLE_TOOL_SEARCH).toBeUndefined();
  });

  it('SEC-32: carries no outbound credentials', () => {
    const env = buildUnattendedEnv(POLLUTED, { provider: 'claude', platform: 'posix' });
    for (const key of [
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'VERCEL_TOKEN',
      'STRIPE_SECRET_KEY',
      'AWS_SECRET_ACCESS_KEY',
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });
});

describe('SEC-20 tests gate env is scrubbed', () => {
  it('has no tokens, no NINEBRAINS_*, no provider secrets or accounts', () => {
    const env = buildScrubbedCommandEnv(POLLUTED, 'posix');
    const keys = Object.keys(env);
    expect(
      keys.filter((k) => /TOKEN|KEY|SECRET|CREDENTIALS|NINEBRAINS|EMDASH|CLAUDE|CODEX/.test(k))
    ).toEqual([]);
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/u', CI: '1' });
  });
});

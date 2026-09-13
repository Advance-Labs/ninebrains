import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { credentialMismatch, ExecRunSupervisor } from './run-supervisor';
import type { ExecRunEvent, ExecRunSpec } from './types';

const FAKE_CLAUDE = fileURLToPath(
  new URL('../../../../../../../../tooling/fake-agent/bin/fake-claude.mjs', import.meta.url)
);
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-sec41-')));
const worktrees = join(root, 'worktrees');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/**
 * The fake reports `apiKeySource` like the real CLI (spike §13): `ANTHROPIC_API_KEY` when that
 * variable is set, else "none". Baking a key into the wrapper stands in for a user's settings
 * `env` block that the launch env can't see.
 */
function fakeClaude(env: Record<string, string>): string {
  const path = join(root, `bin-${randomUUID()}.sh`);
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${q(v)}`);
  writeFileSync(
    path,
    `#!/bin/sh\n${exports.join('\n')}\nexec ${q(process.execPath)} ${q(FAKE_CLAUDE)} "$@"\n`
  );
  chmodSync(path, 0o755);
  return path;
}

/** Slow enough that a kill on the init event lands before the result. */
const SLOW = { FAKE_AGENT_SCRIPT: JSON.stringify([{ sleep: 3000 }, { say: 'done' }]) };

function run(binary: string, over: Partial<ExecRunSpec> = {}, managed: string[] = []) {
  const events: ExecRunEvent[] = [];
  const cwd = join(worktrees, `lane-${randomUUID().slice(0, 8)}`);
  mkdirSync(cwd, { recursive: true });
  const supervisor = new ExecRunSupervisor({
    userDataDir: join(root, 'userData'),
    resolveBinary: async () => binary,
    allowedRoots: () => [worktrees],
    maxConcurrentRuns: 4,
    managedSettingsPaths: managed,
  });
  supervisor.onEvent((event) => events.push(event));
  const result = supervisor.run({
    runId: `run-${randomUUID().slice(0, 8)}`,
    provider: 'claude',
    preset: 'worker',
    cwd,
    prompt: 'hello',
    budgets: { wallClockMs: 20_000 },
    ...over,
  });
  return { result, events };
}

describe('SEC-41 the active credential is checked at run start', () => {
  it('a subscription run whose CLI reports an API key is killed before any work', async () => {
    const started = Date.now();
    const { result, events } = run(
      fakeClaude({ ...SLOW, ANTHROPIC_API_KEY: 'sk-ant-from-settings-000' })
    );
    const done = await result;
    expect(done.reason).toBe('credential-mismatch');
    expect(done.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'security', kind: 'credential-mismatch' })
    );
  });

  it('a subscription run reporting "none" runs normally', async () => {
    const done = await run(fakeClaude({ FAKE_AGENT_SCRIPT: JSON.stringify([{ say: 'ok' }]) }))
      .result;
    expect(done.reason).toBe('completed');
  });

  it('a profile run whose CLI reports another model is killed', async () => {
    const { result } = run(fakeClaude(SLOW), {
      model: 'claude-haiku-4-5',
      routing: {
        auth: {
          mode: 'profile',
          profile: {
            id: 'mock',
            kind: 'local',
            protocol: 'anthropic',
            baseUrl: 'http://127.0.0.1:9',
            model: 'qwen3-coder',
          },
        },
      },
    });
    expect((await result).reason).toBe('credential-mismatch');
  });

  it('a managed settings file that sets a gateway refuses the run before spawn', async () => {
    const managed = join(root, 'managed-settings.json');
    writeFileSync(managed, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://corp.gw' } }));
    const { result } = run(fakeClaude({}), {}, [managed]);
    await expect(result).rejects.toThrow(/managed Claude Code settings set ANTHROPIC_BASE_URL/);
  });

  it('compares apiKeySource exactly and models without the [1m] suffix', () => {
    expect(credentialMismatch({ apiKeySource: 'none' }, { apiKeySource: 'none' })).toBeNull();
    expect(credentialMismatch({ apiKeySource: 'none' }, {})).toMatch(/reported nothing/);
    expect(
      credentialMismatch(
        { apiKeySource: 'none', model: 'kimi-k3' },
        { apiKeySource: 'none', model: 'kimi-k3[1m]' }
      )
    ).toBeNull();
    expect(
      credentialMismatch(
        { apiKeySource: 'none', model: 'kimi-k3' },
        { apiKeySource: 'none', model: 'x' }
      )
    ).toMatch(/expected model/);
  });
});

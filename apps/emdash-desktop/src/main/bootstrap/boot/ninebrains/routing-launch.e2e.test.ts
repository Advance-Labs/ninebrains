import { spawn } from 'node:child_process';
/**
 * Model routing end to end (plan R3 exit, SEC-39, SEC-40), across the slices that build
 * launches: the attended builder (lanes and Brain sessions, brain `launch-config`) and the
 * unattended supervisor (claude and codex runs, reviewers). Cross-slice, so it lives in the
 * composition root's folder (lint: a feature's node code may not import another's).
 *
 * A stub agent stands in for the CLIs: it records its env and argv, and calls the base URL it
 * was given, the way `claude` and `codex` do. A local mock server stands in for the vendor.
 */
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAllowlistedAgentEnv,
  mergeAgentEnvLayers,
} from '@emdash/core/primitives/agent-env/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildLaneLaunch,
  type LaunchConfigDeps,
  type LaunchTarget,
} from '@core/features/brain/node/launch-config';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import type { ExecRunSpec } from '@core/features/exec-runs/api/node/types';
import { GATEWAY_ENV, type LaunchRouting } from '@core/features/routing/api/node/launch-env';

const KEY = 'nbk-test-token-1234567890';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-routing-e2e-')));
const worktrees = join(root, 'worktrees');
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** What a user's shell might carry: another gateway, another key, outbound tokens. */
const POLLUTED = {
  PATH: process.env.PATH ?? '/usr/bin',
  HOME: root,
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil',
  ANTHROPIC_AUTH_TOKEN: 'parent-gateway-token-000',
  ANTHROPIC_API_KEY: 'sk-ant-parent-000000000000',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
  GITHUB_TOKEN: 'ghp_parent0000000000000000',
  NB_MODEL_KEY: 'parent-nb-key-000000',
};

type Request = { path: string; authorization?: string; apiKey?: string; body: string };
const requests: Request[] = [];
let server: http.Server;
let mockUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      requests.push({
        path: req.url ?? '',
        authorization: req.headers.authorization,
        apiKey: req.headers['x-api-key'] as string | undefined,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/**
 * The stub CLI. Claude mode: call `${ANTHROPIC_BASE_URL}/v1/messages` with the token (as the CLI
 * does), then report init and result. Codex mode: find the `nb` provider's base_url and env_key
 * in the `--config` values and call `/responses`. Either way, record env, argv and the
 * `--settings` file.
 */
const STUB = `
import { readFileSync, writeFileSync } from 'node:fs';
const [mode, out] = [process.env.STUB_MODE, process.env.STUB_OUT];
const argv = process.argv.slice(2);
for await (const _ of process.stdin) {}
const flag = (name) => argv.find((a) => a.startsWith(name + '='))?.slice(name.length + 1);
const settingsPath = flag('--settings');
const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null;
const env = { ...process.env };
delete env.STUB_MODE; delete env.STUB_OUT;
writeFileSync(out, JSON.stringify({ env, argv, settings }));
const post = (url, headers) => fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: flag('--model') ?? null }) }).catch(() => {});
if (mode === 'claude') {
  const base = env.ANTHROPIC_BASE_URL;
  if (base) {
    const headers = { 'content-type': 'application/json' };
    if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = 'Bearer ' + env.ANTHROPIC_AUTH_TOKEN;
    if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
    await post(base + '/v1/messages', headers);
  }
  const apiKeySource = env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'none';
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', apiKeySource, model: flag('--model') ?? 'claude-sonnet-5' }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }));
} else {
  const configs = argv.flatMap((a, i) => (a === '-c' ? [argv[i + 1]] : a.startsWith('--config=') ? [a.slice(9)] : []));
  const table = configs.find((c) => c.startsWith('model_providers.nb=')) ?? '';
  const base = /base_url="([^"]+)"/.exec(table)?.[1];
  const keyVar = /env_key="([^"]+)"/.exec(table)?.[1];
  if (base && keyVar) await post(base + '/responses', { 'content-type': 'application/json', authorization: 'Bearer ' + env[keyVar] });
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 't' }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 } }));
}
`;
const stubPath = join(root, 'stub.mjs');
writeFileSync(stubPath, STUB);

const q = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** The supervisor scrubs env (SEC-13), so the stub's own settings are baked into a wrapper. */
function stubBinary(mode: 'claude' | 'codex', out: string): string {
  const path = join(root, `${mode}-${randomUUID()}.sh`);
  writeFileSync(
    path,
    `#!/bin/sh\nexport STUB_MODE=${mode} STUB_OUT=${q(out)}\nexec ${q(process.execPath)} ${q(stubPath)} "$@"\n`
  );
  chmodSync(path, 0o755);
  return path;
}

type Recorded = {
  env: Record<string, string>;
  argv: string[];
  settings: { env?: Record<string, string> } | null;
};
const read = (out: string): Recorded => JSON.parse(readFileSync(out, 'utf8'));

function worktree(): string {
  const dir = join(worktrees, `lane-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runUnattended(provider: 'claude' | 'codex', over: Partial<ExecRunSpec> = {}) {
  const out = join(root, `out-${randomUUID()}.json`);
  const supervisor = new ExecRunSupervisor({
    userDataDir: join(root, 'userData'),
    resolveBinary: async () => stubBinary(provider, out),
    allowedRoots: () => [worktrees],
    maxConcurrentRuns: 4,
    parentEnv: POLLUTED,
    managedSettingsPaths: [],
  });
  const result = await supervisor.run({
    runId: `run-${randomUUID().slice(0, 8)}`,
    provider,
    preset: 'worker',
    cwd: worktree(),
    prompt: 'do the job',
    budgets: { wallClockMs: 20_000 },
    ...over,
  });
  return { result, recorded: read(out) };
}

function attended(
  provider: 'claude' | 'codex',
  routing?: LaunchRouting,
  launchKey = 'lane:lane-1'
) {
  const userDataDir = realpathSync(mkdtempSync(join(root, 'ud-')));
  const deps: LaunchConfigDeps = {
    userDataDir,
    endpoint: { url: 'http://127.0.0.1:4545', mint: () => 't'.repeat(43) },
    brainMcp: { execPath: process.execPath, binPath: '/res/brain-mcp/bin.mjs' },
    managedSettingsPaths: [],
  };
  const target: LaunchTarget = {
    launchKey,
    launchId: launchKey.replace(':', '-'),
    provider,
    worktree: worktree(),
    grant: {
      identity: { role: 'lane', laneId: 'lane-1', projectId: 'p1' },
      projectId: 'p1',
      attachmentRoots: [],
    },
    siblingWorktrees: [],
    ...(routing ? { routing } : {}),
  };
  const launch = buildLaneLaunch(deps, target, { extraArgs: [], autoApprove: false });
  // Upstream's order: the allowlisted shell env (plugin-host), then providerVars (runtime).
  const env = mergeAgentEnvLayers(
    'posix',
    buildAllowlistedAgentEnv(POLLUTED, { platform: 'posix' }),
    launch.providerVars
  );
  const settings = launch.settingsPath
    ? (JSON.parse(readFileSync(launch.settingsPath, 'utf8')) as { env?: Record<string, string> })
    : null;
  return { launch, env, settings };
}

const noGateway = (env: Record<string, string | undefined>) =>
  GATEWAY_ENV.filter((name) => env[name] !== undefined && env[name] !== '');
const providerOverrides = (argv: readonly string[]) => argv.filter((a) => /model_provider/.test(a));

describe('SEC-39 subscription runs carry no routing', () => {
  it('attended Claude lane: the parent gateway is blanked in the env and in --settings', () => {
    const { env, settings, launch } = attended('claude');
    expect(noGateway(env)).toEqual([]);
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('');
    for (const name of GATEWAY_ENV) expect(settings?.env?.[name]).toBe('');
    expect(providerOverrides(launch.extraArgs)).toEqual([]);
  });

  it('Brain session: the same builder, the same neutralizers', () => {
    const { env, settings } = attended('claude', undefined, 'brain:b1');
    expect(noGateway(env)).toEqual([]);
    for (const name of GATEWAY_ENV) expect(settings?.env?.[name]).toBe('');
  });

  it('attended Codex lane: no model_provider override', () => {
    const { launch, env } = attended('codex');
    expect(providerOverrides(launch.extraArgs)).toEqual([]);
    expect(noGateway(env)).toEqual([]);
  });

  it('unattended claude: no gateway variable from the parent, settings blank the user files', async () => {
    const { result, recorded } = await runUnattended('claude');
    expect(result.ok).toBe(true);
    expect(noGateway(recorded.env)).toEqual([]);
    expect(recorded.env.GITHUB_TOKEN).toBeUndefined();
    for (const name of GATEWAY_ENV) expect(recorded.settings?.env?.[name]).toBe('');
  });

  it('unattended codex: no provider override and no inherited NB_MODEL_KEY', async () => {
    const { result, recorded } = await runUnattended('codex');
    expect(result.ok).toBe(true);
    expect(providerOverrides(recorded.argv)).toEqual([]);
    expect(recorded.env.NB_MODEL_KEY).toBeUndefined();
  });

  it('reviewer: no gateway variable either', async () => {
    const { result, recorded } = await runUnattended('claude', { preset: 'reviewer' });
    expect(result.ok).toBe(true);
    expect(noGateway(recorded.env)).toEqual([]);
  });
});

const localAnthropic = (): LaunchRouting => ({
  auth: {
    mode: 'profile',
    profile: {
      id: 'mock',
      kind: 'local',
      protocol: 'anthropic',
      baseUrl: mockUrl,
      model: 'qwen3-coder',
    },
    key: KEY,
  },
});

describe('R3 a profile run reaches only its host, with only its key (SEC-40)', () => {
  it('unattended claude: the mock gets the token; no parent key, no x-api-key; the transcript hides it', async () => {
    requests.length = 0;
    const { result, recorded } = await runUnattended('claude', { routing: localAnthropic() });
    expect(result.ok, result.errors.join('; ')).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: '/v1/messages', authorization: `Bearer ${KEY}` });
    expect(requests[0]!.apiKey).toBeUndefined();
    expect(JSON.parse(requests[0]!.body).model).toBe('qwen3-coder');
    expect(recorded.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(recorded.env.GITHUB_TOKEN).toBeUndefined();
    expect(JSON.stringify(recorded.settings)).not.toContain(KEY);
    expect(readFileSync(result.transcriptPath, 'utf8')).not.toContain(KEY);
  });

  it('attended claude lane: the parent gateway never hears from the process', async () => {
    requests.length = 0;
    const { launch, env } = attended('claude', localAnthropic());
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: mockUrl,
      ANTHROPIC_AUTH_TOKEN: KEY,
      ANTHROPIC_API_KEY: '',
    });
    const out = join(root, `att-${randomUUID()}.json`);
    // Async: the mock server lives in this process, so a sync spawn would deadlock it.
    const child = spawn(process.execPath, [stubPath, ...launch.extraArgs], {
      env: { ...env, STUB_MODE: 'claude', STUB_OUT: out },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.end('hi');
    const status = await new Promise<number | null>((r) => child.once('close', r));
    expect(status).toBe(0);
    expect(requests.map((r) => r.path)).toEqual(['/v1/messages']);
    expect(requests[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(read(out).settings)).not.toContain(KEY);
  });

  it('unattended codex: one nb provider, the key only in NB_MODEL_KEY, the mock gets it', async () => {
    requests.length = 0;
    const { result, recorded } = await runUnattended('codex', {
      routing: {
        auth: {
          mode: 'profile',
          profile: {
            id: 'mock',
            kind: 'local',
            protocol: 'openai-responses',
            baseUrl: `${mockUrl}/v1`,
          },
          key: KEY,
        },
      },
    });
    expect(result.ok, result.errors.join('; ')).toBe(true);
    expect(requests).toEqual([
      expect.objectContaining({ path: '/v1/responses', authorization: `Bearer ${KEY}` }),
    ]);
    expect(requests.some((r) => r.authorization?.includes('parent'))).toBe(false);
    expect(recorded.env.NB_MODEL_KEY).toBe(KEY);
    expect(recorded.argv.join(' ')).not.toContain(KEY);
    expect(readFileSync(result.transcriptPath, 'utf8')).not.toContain(KEY);
  });
});

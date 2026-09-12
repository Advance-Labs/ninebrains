/**
 * End to end: the SEO red-team gate through the app's real `spawnReviewer`, a real review
 * checkout and the fake Claude CLI. Before the fix, `spawnReviewer` read the packs'
 * `McpServerEntry[]` as a record, rejected the http entry as invalid, and every SEO review failed
 * with "could not run".
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence, GateContext, GateJob } from '@emdash/gates-core';
import { afterAll, describe, expect, it } from 'vitest';
import { ExecRunSupervisor } from '@core/features/exec-runs/api/node/run-supervisor';
import { createPrepareReviewCheckout } from '@core/features/gates/node/capabilities/review-checkout';
import { createSpawnReviewer } from '@core/features/gates/node/capabilities/spawn-reviewer';
import {
  ECHO_MCP_SERVER,
  fakeClaudeWrapper,
  makeRepoWithLanes,
  tempRoot,
} from '@core/features/gates/node/capabilities/test-fixtures';
import type { McpServerEntry } from '../../api/launch';
import { seoEvidenceGate } from './seo-evidence-gate';

const root = tempRoot('nb-seo-e2e-');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const {
  worktrees,
  lanePaths: [lane],
} = makeRepoWithLanes(root, ['lane-seo']);
const checkouts = join(root, 'checkouts');
const userData = join(root, 'userData');
mkdirSync(checkouts, { recursive: true });

const HEADER_SECRET = 'Bearer seo-header-secret-0123456789';
const SERVERS: McpServerEntry[] = [
  {
    name: 'aeo-search',
    type: 'http',
    url: 'https://aeo.example.invalid/mcp',
    headers: { Authorization: HEADER_SECRET },
  },
  { name: 'echo', type: 'stdio', command: process.execPath, args: [ECHO_MCP_SERVER], env: {} },
];

const FINDINGS = {
  site: 'https://example.com/',
  findings: [
    {
      id: 'F1',
      title: 'Clicks fell',
      recommendation: 'Fix F1.',
      evidence: [
        {
          type: 'query',
          server: 'aeo-search',
          tool: 'gsc_search_analytics',
          args: { siteUrl: 'sc-domain:example.com' },
          observed: { clicks: 120 },
        },
      ],
    },
  ],
};
const VERDICT = JSON.stringify({
  verdicts: [{ id: 'F1', status: 'confirmed', note: 're-ran the query' }],
});

describe('SEO evidence gate end to end with the fake agent', () => {
  it('runs a review whose pack servers include an http entry', async () => {
    const supervisor = new ExecRunSupervisor({
      userDataDir: userData,
      resolveBinary: async () =>
        fakeClaudeWrapper(root, {
          FAKE_AGENT_SCRIPT: JSON.stringify([
            { callTool: { server: 'echo', tool: 'echo', args: { text: 'gsc rows' } } },
            { say: VERDICT },
          ]),
        }),
      allowedRoots: () => [worktrees, checkouts],
      maxConcurrentRuns: 2,
    });
    const stored: Evidence[] = [];
    const job: GateJob = { id: 'job-seo', title: 'Audit', body: 'Audit', kind: 'seo', attempt: 1 };
    const ctx: GateContext = {
      job,
      worktreePath: lane,
      signal: new AbortController().signal,
      evidence: {
        dir: join(root, 'evidence'),
        put: async (input) => {
          const evidence: Evidence = {
            kind: input.kind,
            label: input.label,
            path: join(root, input.fileName),
          };
          stored.push(evidence);
          return evidence;
        },
        list: () => [...stored],
      },
      capabilities: {
        captureScreenshot: async () => {
          throw new Error('unused');
        },
        runCommand: async () => {
          throw new Error('unused');
        },
        spawnReviewer: createSpawnReviewer({
          supervisor,
          checkoutRoot: checkouts,
          laneWorktrees: () => [lane],
        }),
        prepareReviewCheckout: createPrepareReviewCheckout({
          worktreeForJob: () => lane,
          root: checkouts,
        }),
        fetchText: async () => {
          throw new Error('offline');
        },
        readWorktreeFile: async () => JSON.stringify(FINDINGS),
      },
    };

    const result = await seoEvidenceGate({ resolveReviewerServers: async () => SERVERS }).run(ctx);

    expect(result.feedback).not.toMatch(/could not run/);
    expect(result).toMatchObject({ pass: true, metrics: { findings: 1, confirmed: 1 } });
    // The reviewer's per-run config carried both servers (the fake CLI only speaks stdio, so it
    // reports the http one as failed), and the http header never reached the transcript.
    const runs = join(userData, 'ninebrains', 'runs');
    const transcripts = readdirSync(runs)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => readFileSync(join(runs, f), 'utf8'))
      .join('\n');
    const init = transcripts
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((event) => event.type === 'system' && event.subtype === 'init');
    expect(init.mcp_servers).toEqual(
      expect.arrayContaining([
        { name: 'aeo-search', status: 'failed' },
        { name: 'echo', status: 'connected' },
      ])
    );
    expect(transcripts).not.toContain('seo-header-secret');
    expect(readdirSync(checkouts)).toEqual([]);
  });
});

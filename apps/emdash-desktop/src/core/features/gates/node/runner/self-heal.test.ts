/**
 * The Phase 4 self-heal loop at the service level, with the real gates-core
 * built-ins (tests + screenshot at the default rigor 5/5) and a fake CDP host.
 * Attempt 1 serves a page with a console error, so the screenshot gate fails
 * and the feedback lands in the lane's inbox. The "agent" fixes the page and
 * calls complete_job again; attempt 2 passes with three screenshots on disk.
 * The Electron e2e (`e2e/self-heal.e2e.mjs`) repeats this with a real webview.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { COMPLETE_JOB_TOOL, type Viewport } from '@emdash/gates-core';
import { afterEach, describe, expect, it } from 'vitest';
import { LANE, createGateFixture, type GateFixture } from './test-fixtures';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let fixture: GateFixture | undefined;
afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe('self-heal: a broken UI job fails the screenshot gate, then passes on attempt 2', () => {
  it('routes the console error back to the lane and verifies the fix with evidence', async () => {
    const page = { broken: true };
    const captured: Array<{ viewport: Viewport; url: string; browserId?: string }> = [];
    let reviews = 0;
    fixture = await createGateFixture({
      prefs: { testCommand: 'pnpm test' },
      previewUrl: 'http://127.0.0.1:5173/',
      screenshots: {
        capture: async (target, viewport, { url }) => {
          captured.push({ viewport, url, browserId: target.browserId });
          return {
            png: PNG,
            consoleErrors: page.broken ? ['Uncaught TypeError: hero is undefined'] : [],
            failedRequests: [],
          };
        },
      },
      capabilities: {
        spawnReviewer: async () => {
          reviews += 1;
          return { text: '{"pass": true, "issues": []}' };
        },
      },
    });
    const f = fixture;
    const job = f.createJob({ gates: [], kind: 'ui' }, 'Hero section');
    expect(job.gateSpec?.gates).toEqual(['tests', 'screenshot']);

    const first = await f.runner.verifyJob(job.id);
    expect(first).toMatchObject({ status: 'failed', decision: 'retry', attempt: 1 });
    expect(f.job(job.id)).toMatchObject({ state: 'running', attempts: 1 });
    const feedback = f.brain.readInbox(LANE)[0]?.body ?? '';
    expect(feedback).toContain('console error: Uncaught TypeError: hero is undefined');
    expect(feedback).toContain(COMPLETE_JOB_TOOL);
    expect(reviews).toBe(0); // deterministic failures short-circuit the paid reviewer

    page.broken = false; // the agent fixes the page
    f.resubmit(job.id);
    const second = await f.runner.verifyJob(job.id);

    expect(second).toMatchObject({ status: 'passed', decision: 'pass', attempt: 2 });
    expect(f.job(job.id).state).toBe('done');
    expect(f.job(job.id).result?.verification).toMatchObject({ verified: true, attempt: 2 });
    expect(reviews).toBe(1);
    const files = await readdir(join(f.evidenceRoot, job.id, '2'));
    expect(files.filter((name) => name.startsWith('screenshot-')).sort()).toEqual([
      'screenshot-desktop-1440.png',
      'screenshot-mobile-390.png',
      'screenshot-tablet-768.png',
    ]);
    expect(new Set(captured.map((c) => c.viewport.width))).toEqual(new Set([1440, 768, 390]));
    expect(captured.every((c) => c.url === 'http://127.0.0.1:5173/')).toBe(true);
    expect(captured.every((c) => c.browserId === 'browser-lane1')).toBe(true);
  });
});

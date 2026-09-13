import { describe, expect, it, vi } from 'vitest';
import { makeContext, solidPng } from '../test-utils';
import { GatePreconditionError, type ScreenshotCapture, type Viewport } from '../types';
import { screenshotGate, SCREENSHOT_PRECONDITION_METRIC } from './screenshot-gate';

const PREVIEW = 'http://localhost:5173/pricing';
const APPROVE = JSON.stringify({ pass: true, issues: [] });

function setup(
  capture: (viewport: Viewport) => Partial<ScreenshotCapture> = () => ({}),
  reply: string | Error = APPROVE
) {
  const captureScreenshot = vi.fn(async (viewport: Viewport) => ({
    png: solidPng(4, 4),
    consoleErrors: [],
    failedRequests: [],
    ...capture(viewport),
  }));
  const spawnReviewer = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { text: reply };
  });
  const dispose = vi.fn(async () => undefined);
  const prepareReviewCheckout = vi.fn(async () => ({
    path: '/tmp/ninebrains-review-shots',
    dispose,
  }));
  const ctx = makeContext({
    previewUrl: PREVIEW,
    capabilities: { captureScreenshot, spawnReviewer, prepareReviewCheckout },
  });
  return { ctx, captureScreenshot, spawnReviewer, dispose };
}

describe('screenshotGate', () => {
  it('captures 1440, 768 and 390, then passes on a reviewer approval', async () => {
    const { ctx, captureScreenshot, spawnReviewer, dispose } = setup();
    const result = await screenshotGate().run(ctx);

    expect(result.pass).toBe(true);
    expect(captureScreenshot.mock.calls.map(([v]) => v.width)).toEqual([1440, 768, 390]);
    expect(result.evidence.filter((e) => e.kind === 'screenshot')).toHaveLength(3);
    const [prompt, opts] = spawnReviewer.mock.calls[0] as unknown as [
      string,
      { cwd: string; tools: string; attachments: unknown[] },
    ];
    expect(prompt).toMatch(/<<<JOB-[0-9a-f]{16}>>>\nAdd a pricing table/);
    // SEC-18: the visual reviewer also works from a disposable checkout.
    expect(opts).toMatchObject({ cwd: '/tmp/ninebrains-review-shots', tools: 'read-only' });
    expect(JSON.stringify([prompt, opts])).not.toContain(ctx.worktreePath);
    expect(opts.attachments).toHaveLength(3);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('fails on console errors without spending a reviewer run', async () => {
    const { ctx, spawnReviewer } = setup((v) =>
      v.width === 390 ? { consoleErrors: ['TypeError: plans is undefined'] } : {}
    );
    const result = await screenshotGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain(
      '[mobile 390px] console error: TypeError: plans is undefined'
    );
    expect(result.metrics?.consoleErrors).toBe(1);
    expect(spawnReviewer).not.toHaveBeenCalled();
  });

  it('fails on failed same-origin requests and ignores third-party failures', async () => {
    const thirdParty = setup(() => ({
      failedRequests: [{ url: 'https://cdn.example.com/a.js', status: 404 }],
    }));
    expect((await screenshotGate().run(thirdParty.ctx)).pass).toBe(true);

    const own = setup((v) =>
      v.width === 768 ? { failedRequests: [{ url: '/api/plans', status: 500 }] } : {}
    );
    const result = await screenshotGate().run(own.ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('request failed: /api/plans (500)');
  });

  it('fails when the capture exceeds the baseline diff budget and stores the diff', async () => {
    const { ctx } = setup(() => ({
      png: solidPng(4, 4, [255, 255, 255], { x: 0, y: 0, w: 2, h: 2, rgb: [0, 0, 0] }),
    }));
    const gate = screenshotGate({
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      loadBaseline: async () => solidPng(4, 4),
    });
    const result = await gate.run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toMatch(/25\.00% of pixels differ/);
    expect(result.metrics?.maxDiffRatio).toBeCloseTo(0.25);
    expect(result.evidence.some((e) => e.label.startsWith('Pixel diff'))).toBe(true);
  });

  it('passes a diff within budget', async () => {
    const { ctx } = setup();
    const result = await screenshotGate({ loadBaseline: async () => solidPng(4, 4) }).run(ctx);
    expect(result.pass).toBe(true);
  });

  it('fails on a malformed reviewer reply and keeps the raw reply as evidence', async () => {
    const { ctx } = setup(undefined, 'Looks great to me!');
    const result = await screenshotGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toMatch(/not a valid verdict/);
    expect(result.evidence.some((e) => e.label === 'Malformed reviewer reply')).toBe(true);
  });

  it('fails with the reviewer issues when the reviewer rejects', async () => {
    const reject = JSON.stringify({
      pass: false,
      issues: [{ message: 'Plans overlap at 390px', severity: 'blocker' }],
    });
    const { ctx } = setup(undefined, reject);
    const result = await screenshotGate().run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('[blocker] Plans overlap at 390px');
  });

  it('fails when there is no preview URL or a capture throws', async () => {
    const noPreview = makeContext();
    expect((await screenshotGate().run(noPreview)).feedback).toMatch(/No preview URL/);

    const { ctx } = setup();
    ctx.capabilities.captureScreenshot = async () => {
      throw new Error('webview not attached');
    };
    const result = await screenshotGate({ reviewer: false }).run(ctx);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain('capture failed: webview not attached');
  });

  it('marks a precondition failure (DevTools open) instead of an ordinary verdict', async () => {
    const { ctx } = setup();
    ctx.capabilities.captureScreenshot = async () => {
      throw new GatePreconditionError('gate skipped: devtools open');
    };
    const result = await screenshotGate({ reviewer: false }).run(ctx);
    expect(result.pass).toBe(false);
    expect(result.metrics?.[SCREENSHOT_PRECONDITION_METRIC]).toBe(1);
    expect(result.feedback).toContain('setup problem, not your change');
    expect(result.feedback).toContain('capture failed: gate skipped: devtools open');
  });

  it('does not mark a precondition failure when only some viewports were skipped', async () => {
    const { ctx } = setup();
    let calls = 0;
    ctx.capabilities.captureScreenshot = async () => {
      calls += 1;
      if (calls === 1) throw new GatePreconditionError('gate skipped: devtools open');
      return { png: solidPng(4, 4), consoleErrors: [], failedRequests: [] };
    };
    const result = await screenshotGate({ reviewer: false }).run(ctx);
    expect(result.pass).toBe(false);
    expect(result.metrics?.[SCREENSHOT_PRECONDITION_METRIC]).toBeUndefined();
  });
});

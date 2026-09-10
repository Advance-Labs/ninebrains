/**
 * Screenshot gate: capture the lane's preview at three widths, fail on console
 * errors and failed same-origin requests, optionally pixel-diff against a
 * baseline, then ask a separate reviewer whether the page satisfies the task.
 *
 * The deterministic checks run first and short-circuit: a page that throws in
 * the console has failed already, and a reviewer run costs real money.
 */

import { pixelDiff } from '../pixel-diff';
import {
  VERDICT_INSTRUCTIONS,
  describeEvidence,
  describeTask,
  formatIssues,
  parseReviewerVerdict,
} from '../reviewer-verdict';
import type { Evidence, Gate, GateTask, Viewport } from '../types';
import { errorMessage } from '../util';

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile', width: 390, height: 844 },
];

export interface ScreenshotGateOptions {
  viewports?: Viewport[];
  /** Returns the approved baseline PNG for a viewport, or undefined to skip the diff. */
  loadBaseline?: (viewport: Viewport, task: GateTask) => Promise<Uint8Array | undefined>;
  /** pixelmatch per-pixel tolerance. Default 0.1. */
  diffThreshold?: number;
  /** Largest share of differing pixels still accepted. Default 0.01. */
  maxDiffRatio?: number;
  /** Ask a reviewer for a vision verdict. Default true. */
  reviewer?: boolean;
  appliesTo?: (task: GateTask) => boolean;
}

const MAX_LISTED = 20;

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

export function screenshotGate(options: ScreenshotGateOptions = {}): Gate {
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const maxDiffRatio = options.maxDiffRatio ?? 0.01;

  return {
    id: 'screenshot',
    title: 'Screenshot',
    appliesTo: options.appliesTo ?? ((task) => task.kind === 'ui'),
    async run(ctx) {
      const previewUrl = ctx.previewUrl;
      if (!previewUrl) {
        return {
          pass: false,
          evidence: [],
          feedback:
            'No preview URL for this lane. Start the dev server so the page can be captured.',
        };
      }
      const origin = new URL(previewUrl).origin;
      const shots: Evidence[] = [];
      const extra: Evidence[] = [];
      const problems: string[] = [];
      const report: unknown[] = [];
      let consoleErrors = 0;
      let failedRequests = 0;
      let worstDiff = 0;

      for (const viewport of viewports) {
        const tag = `${viewport.label} ${viewport.width}px`;
        let capture;
        try {
          capture = await ctx.capabilities.captureScreenshot(viewport, {
            url: previewUrl,
            signal: ctx.signal,
          });
        } catch (error) {
          problems.push(`[${tag}] capture failed: ${errorMessage(error)}`);
          continue;
        }

        shots.push(
          await ctx.evidence.put({
            kind: 'screenshot',
            label: `Screenshot at ${tag}`,
            fileName: `screenshot-${viewport.label}-${viewport.width}.png`,
            data: capture.png,
          })
        );

        const failed = capture.failedRequests.filter((r) => sameOrigin(r.url, origin));
        consoleErrors += capture.consoleErrors.length;
        failedRequests += failed.length;
        for (const message of capture.consoleErrors)
          problems.push(`[${tag}] console error: ${message}`);
        for (const r of failed) {
          problems.push(`[${tag}] request failed: ${r.url} (${r.status ?? r.error ?? 'failed'})`);
        }

        let diffRatio: number | undefined;
        const baseline = options.loadBaseline
          ? await options.loadBaseline(viewport, ctx.task)
          : undefined;
        if (baseline) {
          const diff = pixelDiff(baseline, capture.png, { threshold: options.diffThreshold });
          diffRatio = diff.ratio;
          worstDiff = Math.max(worstDiff, diff.ratio);
          if (diff.diffPng) {
            extra.push(
              await ctx.evidence.put({
                kind: 'screenshot',
                label: `Pixel diff vs baseline at ${tag}`,
                fileName: `diff-${viewport.label}-${viewport.width}.png`,
                data: diff.diffPng,
              })
            );
          }
          if (diff.sizeMismatch) {
            problems.push(`[${tag}] screenshot size differs from the baseline`);
          } else if (diff.ratio > maxDiffRatio) {
            problems.push(
              `[${tag}] ${(diff.ratio * 100).toFixed(2)}% of pixels differ from the baseline ` +
                `(limit ${(maxDiffRatio * 100).toFixed(2)}%)`
            );
          }
        }
        report.push({
          viewport,
          consoleErrors: capture.consoleErrors,
          failedRequests: failed,
          diffRatio,
        });
      }

      extra.push(
        await ctx.evidence.put({
          kind: 'json',
          label: 'Capture report',
          fileName: 'capture-report.json',
          data: JSON.stringify({ previewUrl, viewports: report }, null, 2),
        })
      );
      const evidence = [...shots, ...extra];
      const metrics = {
        viewports: shots.length,
        consoleErrors,
        failedRequests,
        maxDiffRatio: worstDiff,
      };

      if (problems.length > 0) {
        const listed = problems.slice(0, MAX_LISTED).map((p) => `- ${p}`);
        if (problems.length > MAX_LISTED)
          listed.push(`- … and ${problems.length - MAX_LISTED} more`);
        return {
          pass: false,
          evidence,
          feedback: `The page at ${previewUrl} has problems:\n${listed.join('\n')}`,
          metrics,
        };
      }
      if (options.reviewer === false) {
        return {
          pass: true,
          evidence,
          feedback: 'Page captured cleanly at every viewport.',
          metrics,
        };
      }

      const prompt = [
        'You are verifying a UI change. The attached screenshots show the page at desktop, ' +
          `tablet and mobile widths (${previewUrl}). Decide whether what is visible satisfies ` +
          'the task. Check layout at every width, missing or broken content, and overflow.',
        describeTask(ctx.task),
        describeEvidence(shots),
        VERDICT_INSTRUCTIONS,
      ].join('\n\n');

      let reply: string;
      try {
        ({ text: reply } = await ctx.capabilities.spawnReviewer(prompt, {
          signal: ctx.signal,
          cwd: ctx.worktreePath,
          readOnly: true,
          attachments: shots,
          purpose: 'screenshot',
        }));
      } catch (error) {
        return {
          pass: false,
          evidence,
          feedback: `Visual reviewer failed to run: ${errorMessage(error)}`,
          metrics,
        };
      }

      const parsed = parseReviewerVerdict(reply);
      if (!parsed.ok) {
        evidence.push(
          await ctx.evidence.put({
            kind: 'text',
            label: 'Malformed reviewer reply',
            fileName: 'visual-review.txt',
            data: reply,
          })
        );
        return {
          pass: false,
          evidence,
          feedback: `The visual reviewer's reply was not a valid verdict (${parsed.error}), so the page is unverified.`,
          metrics,
        };
      }
      evidence.push(
        await ctx.evidence.put({
          kind: 'json',
          label: 'Visual review verdict',
          fileName: 'visual-review.json',
          data: JSON.stringify(parsed.verdict, null, 2),
        })
      );
      const issues = formatIssues(parsed.verdict.issues);
      return parsed.verdict.pass
        ? {
            pass: true,
            evidence,
            feedback: `Visual review passed.${issues ? `\nNotes:\n${issues}` : ''}`,
            metrics,
          }
        : { pass: false, evidence, feedback: `Visual review found problems:\n${issues}`, metrics };
    },
  };
}

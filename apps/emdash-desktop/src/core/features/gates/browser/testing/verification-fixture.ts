import type { JobVerificationView } from '../../api';

/** A 1×1 PNG, so thumbnails render in tests without real screenshots. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const shots = (attempt: number) =>
  ['desktop-1440', 'tablet-768', 'mobile-390'].map((name) => ({
    kind: 'screenshot' as const,
    label: `Screenshot at ${name.replace('-', ' ')}px`,
    file: `screenshot-${name}.png`,
    bytes: 4096,
    createdAt: `2026-09-10T12:0${attempt}:00.000Z`,
  }));

const log = {
  kind: 'log' as const,
  label: 'Last 200 lines of `pnpm test`',
  file: 'tests.log',
  bytes: 120,
  createdAt: '2026-09-10T12:00:00.000Z',
};

/** The self-heal demo as the modal sees it: attempt 1 failed the screenshot gate, attempt 2 passed. */
export const JOB_VERIFICATION_FIXTURE: JobVerificationView = {
  jobId: 'job-hero',
  title: 'Hero section for the landing page',
  state: 'done',
  kind: 'ui',
  attempts: 1,
  maxAttempts: 3,
  latest: { status: 'passed', verified: true, attempt: 2 },
  workerArtifacts: ['docs/hero-notes.md'],
  history: [
    {
      attempt: 1,
      evidence: [log, ...shots(1)],
      verdict: {
        version: 1,
        jobId: 'job-hero',
        attempt: 1,
        jobUpdatedAt: 1,
        status: 'failed',
        decision: 'retry',
        feedback: 'Attempt 1 of 3 failed verification.',
        gateIds: ['tests', 'screenshot'],
        skipped: [],
        at: 1,
        gates: [
          {
            gateId: 'tests',
            title: 'Tests',
            status: 'pass',
            feedback: '`pnpm test` passed.',
            durationMs: 4200,
            evidence: [{ kind: 'log', label: log.label, file: 'tests.log' }],
          },
          {
            gateId: 'screenshot',
            title: 'Screenshot',
            status: 'fail',
            feedback:
              'The page at http://127.0.0.1:5173/ has problems:\n- [desktop 1440px] console error: Uncaught TypeError: hero is undefined\n- [tablet 768px] console error: Uncaught TypeError: hero is undefined\n- [mobile 390px] console error: Uncaught TypeError: hero is undefined',
            durationMs: 3100,
            evidence: shots(1).map(({ kind, label, file }) => ({ kind, label, file })),
          },
        ],
      },
    },
    {
      attempt: 2,
      evidence: [log, ...shots(2)],
      verdict: {
        version: 1,
        jobId: 'job-hero',
        attempt: 2,
        jobUpdatedAt: 2,
        status: 'passed',
        decision: 'pass',
        feedback: 'All 2 verification gates passed.',
        gateIds: ['tests', 'screenshot'],
        skipped: [],
        at: 2,
        gates: [
          {
            gateId: 'tests',
            title: 'Tests',
            status: 'pass',
            feedback: '`pnpm test` passed.',
            durationMs: 3900,
            evidence: [{ kind: 'log', label: log.label, file: 'tests.log' }],
          },
          {
            gateId: 'screenshot',
            title: 'Screenshot',
            status: 'pass',
            feedback: 'Visual review passed.',
            durationMs: 9800,
            evidence: shots(2).map(({ kind, label, file }) => ({ kind, label, file })),
          },
        ],
      },
    },
  ],
};

/** Evidence bytes for the fixture: a pixel for PNGs, a short log otherwise. */
export function fixtureEvidence(file: string, pngBase64 = PIXEL): { mime: string; base64: string } {
  if (file.endsWith('.png')) return { mime: 'image/png', base64: pngBase64 };
  return {
    mime: 'text/plain',
    base64: btoa(
      '$ pnpm test\nexit: 0\n\n  PASS hero renders (12 ms)\n  PASS layout at 390px (8 ms)\n'
    ),
  };
}

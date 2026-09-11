import { err, ok } from '@emdash/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import { gatesContract, gatesDomain, type JobVerificationView } from '../api';
import { GatesSettingsPanel } from './gates-settings-view';
import { JobVerification } from './job-verification';
import { JOB_VERIFICATION_FIXTURE, fixtureEvidence } from './testing/verification-fixture';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('job verification through the wire seam', () => {
  let view: JobVerificationView;
  let handle: { dispose: () => Promise<void> };
  let host: HTMLDivElement;
  let root: Root;
  const reads: string[] = [];

  beforeEach(() => {
    view = JOB_VERIFICATION_FIXTURE;
    reads.length = 0;
    handle = seedSliceWire(gatesDomain, gatesContract, {
      getVerification: async ({ jobId }: { jobId: string }) =>
        jobId === view.jobId
          ? ok(view)
          : err({ type: 'not-found', message: `There is no job ${jobId}.` }),
      readEvidence: async (input: { attempt: number; file: string }) => {
        reads.push(`${input.attempt}/${input.file}`);
        return ok(fixtureEvidence(input.file));
      },
      deleteEvidence: async ({ jobId }: { jobId: string }) => ok({ jobId }),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await handle.dispose();
  });

  async function render(jobId = view.jobId) {
    await act(async () => root.render(<JobVerification jobId={jobId} />));
    await vi.waitFor(() => expect(host.textContent).not.toContain('Loading verification'));
  }

  it('shows every attempt, newest first, with gate results and feedback', async () => {
    await render();
    const attempts = [...host.querySelectorAll('section[aria-label^="Attempt"]')].map((s) =>
      s.getAttribute('aria-label')
    );
    expect(attempts).toEqual(['Attempt 2', 'Attempt 1']);
    expect(host.textContent).toContain('Verified');
    expect(host.textContent).toContain('Failed, sent back');
    expect(host.textContent).toContain('console error: Uncaught TypeError');
  });

  it('loads the three screenshots per attempt and enlarges one on click', async () => {
    await render();
    await vi.waitFor(() =>
      expect(host.querySelectorAll('img[src^="data:image/png"]')).toHaveLength(6)
    );
    const newest = host.querySelector('section[aria-label="Attempt 2"]')!;
    const labels = [...newest.querySelectorAll('figcaption')].map((c) => c.textContent);
    expect(labels).toEqual(['1440 px', '768 px', '390 px']);

    await act(async () =>
      newest
        .querySelector<HTMLButtonElement>('button[aria-label="Enlarge the 390 px screenshot"]')!
        .click()
    );
    expect(
      document.querySelector('[role="group"][aria-label="Attempt 2, 390 px"] img')
    ).not.toBeNull();
  });

  it('shows a log excerpt on demand', async () => {
    await render();
    const attempt1 = host.querySelector('section[aria-label="Attempt 1"]')!;
    const show = [...attempt1.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Show')
    )!;
    await act(async () => show.click());
    await vi.waitFor(() => expect(attempt1.querySelector('pre')?.textContent).toContain('exit: 0'));
    expect(reads).toContain('1/tests.log');
  });

  it('marks an unverified job with a badge, never as passed', async () => {
    view = {
      ...JOB_VERIFICATION_FIXTURE,
      latest: { status: 'unverified', verified: false, attempt: 1 },
      history: [],
    };
    await render();
    const badges = [...host.querySelectorAll('span')].map((s) => s.textContent);
    expect(badges).toContain('Unverified');
    expect(badges).not.toContain('Verified');
  });

  it('labels worker artifacts as worker-supplied, not evidence', async () => {
    await render();
    expect(host.textContent).toContain('Worker-supplied files');
    expect(host.textContent).toContain('They are not evidence');
  });

  it('shows the error for an unknown job', async () => {
    await render('missing');
    expect(host.textContent).toContain('There is no job missing.');
  });
});

describe('gates settings panel', () => {
  it('moves a slider and reflects which gates attach', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    const settings = { testingRigor: 5, securityRigor: 5, evidenceRetentionDays: 30 };
    await act(async () =>
      root.render(<GatesSettingsPanel settings={settings} onChange={onChange} />)
    );

    const rows = [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    expect(rows.find((r) => r?.startsWith('Screenshots'))).toContain('On');
    expect(rows.find((r) => r?.startsWith('Reviewer agent'))).toContain('Off');

    const slider = host.querySelector<HTMLInputElement>('input[aria-label="Security rigor"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '8');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ securityRigor: 8 });
    await act(async () => root.unmount());
    host.remove();
  });
});

import '@emdash/ui/style.css';
import { ok } from '@emdash/shared';
import { Dialog } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { gatesContract, gatesDomain } from '@core/features/gates/api';
import { GatesSettingsPanel } from '@core/features/gates/browser/gates-settings-view';
import { JobVerificationModal } from '@core/features/gates/browser/job-verification-modal';
import {
  JOB_VERIFICATION_FIXTURE,
  fixtureEvidence,
} from '@core/features/gates/browser/testing/verification-fixture';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';

// Renders the "Job verification" modal and Settings → Gates with the app's real CSS and writes
// docs/screenshots/gates-*.png. Opt-in, so ordinary runs never touch tracked files. The CSS is
// precompiled into the untracked __generated__/gates-tailwind.css first (features/gates/README.md).
import.meta.glob('./__generated__/gates-tailwind.css', { eager: true });

const SHOTS = '../../../../../../docs/screenshots';
const HEIGHT: Record<number, number> = { 1440: 900, 768: 1024, 390: 844 };

/** A stand-in capture of the lane's preview: attempt 1 lost its hero to a TypeError. */
function mockCapture(width: number, broken: boolean): string {
  const height = HEIGHT[width] ?? 900;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const narrow = width < 600;
  ctx.fillStyle = '#f6f5f1';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#16211d';
  ctx.fillRect(0, 0, width, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 22px sans-serif';
  ctx.fillText('Acme Build', 24, 40);
  const pad = narrow ? 20 : 64;
  const heroH = narrow ? 300 : 360;
  if (broken) {
    ctx.strokeStyle = '#c9c4b8';
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(pad, 96, width - pad * 2, heroH);
    ctx.fillStyle = '#8a8478';
    ctx.font = '16px sans-serif';
    ctx.fillText('(hero did not render)', pad + 24, 96 + heroH / 2);
  } else {
    ctx.fillStyle = '#0f5c4d';
    ctx.fillRect(pad, 96, width - pad * 2, heroH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${narrow ? 30 : 48}px sans-serif`;
    ctx.fillText('Renovations, on schedule', pad + 32, 96 + heroH / 2 - 10);
    ctx.font = '18px sans-serif';
    ctx.fillText('Quotes in 48 hours. Permits handled.', pad + 32, 96 + heroH / 2 + 30);
    ctx.fillStyle = '#e8b04a';
    ctx.fillRect(pad + 32, 96 + heroH - 88, 180, 48);
  }
  const cols = narrow ? 1 : width < 1000 ? 2 : 3;
  const gap = 24;
  const cardW = (width - pad * 2 - gap * (cols - 1)) / cols;
  for (let i = 0; i < cols * (narrow ? 2 : 1); i += 1) {
    const x = pad + (i % cols) * (cardW + gap);
    const y = 96 + heroH + 32 + Math.floor(i / cols) * 200;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cardW, 170);
    ctx.fillStyle = '#d9d4c7';
    ctx.fillRect(x + 20, y + 24, cardW * 0.5, 14);
    ctx.fillRect(x + 20, y + 52, cardW * 0.8, 10);
    ctx.fillRect(x + 20, y + 72, cardW * 0.7, 10);
  }
  return canvas.toDataURL('image/png').split(',')[1]!;
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe.skipIf(!import.meta.env.VITE_GATES_SCREENSHOTS)('gates screenshots', () => {
  let handle: { dispose: () => Promise<void> };
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    handle = seedSliceWire(gatesDomain, gatesContract, {
      getVerification: async () => ok(JOB_VERIFICATION_FIXTURE),
      readEvidence: async ({ attempt, file }: { attempt: number; file: string }) => {
        const width = Number(/-(\d+)\.png$/.exec(file)?.[1] ?? 0);
        return ok(fixtureEvidence(file, width ? mockCapture(width, attempt === 1) : undefined));
      },
      deleteEvidence: async ({ jobId }: { jobId: string }) => ok({ jobId }),
      getProjectPrefs: async ({ projectId }: { projectId: string }) =>
        ok({ projectId, testCommand: 'pnpm test' }),
      setTestCommand: async (input: { projectId: string; testCommand: string | null }) => ok(input),
    });
    document.body.style.margin = '0';
    host = document.createElement('div');
    host.style.width = '100vw';
    host.style.height = '100vh';
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await handle.dispose();
  });

  async function render(
    theme: 'emlight' | 'emdark',
    width: number,
    height: number,
    ui: React.ReactNode
  ) {
    await page.viewport(width, height);
    document.documentElement.className = theme;
    await act(async () => {
      root.render(
        <ThemeProvider theme={theme} onThemeChange={vi.fn()}>
          <div className={`${theme} h-full bg-background text-foreground`}>{ui}</div>
        </ThemeProvider>
      );
    });
  }

  async function showModal(theme: 'emlight' | 'emdark', width: number, height: number) {
    await render(
      theme,
      width,
      height,
      <Dialog.Root open>
        <Dialog.Content size="lg">
          <JobVerificationModal jobId={JOB_VERIFICATION_FIXTURE.jobId} />
        </Dialog.Content>
      </Dialog.Root>
    );
    await vi.waitFor(() => {
      if (document.querySelectorAll('img[src^="data:image/png"]').length < 6)
        throw new Error('thumbnails not loaded');
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const settings = { testingRigor: 7, securityRigor: 6, evidenceRetentionDays: 30 };
  const testCommand = {
    projects: [
      { id: 'acme', name: 'acme-build' },
      { id: 'docs', name: 'docs-site' },
    ],
    projectId: 'acme',
    onProjectChange: vi.fn(),
    savedCommand: 'pnpm test',
    onSave: async () => null,
  };

  it('verification modal, light, 1440', async () => {
    await showModal('emlight', 1440, 900);
    await page.screenshot({ path: `${SHOTS}/gates-verification-1440.png` });
  });

  it('verification modal, a screenshot enlarged, 1440', async () => {
    await showModal('emlight', 1440, 900);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'section[aria-label="Attempt 1"] button[aria-label="Enlarge the 1440 px screenshot"]'
        )!
        .click()
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.screenshot({ path: `${SHOTS}/gates-verification-enlarged-1440.png` });
  });

  it('verification modal, dark, 390', async () => {
    await showModal('emdark', 390, 844);
    await page.screenshot({ path: `${SHOTS}/gates-verification-390.png` });
  });

  it('settings, light, 1440', async () => {
    await render(
      'emlight',
      1440,
      900,
      <GatesSettingsPanel settings={settings} onChange={vi.fn()} testCommand={testCommand} />
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.screenshot({ path: `${SHOTS}/gates-settings-1440.png` });
  });

  it('settings, dark, 390', async () => {
    await render(
      'emdark',
      390,
      844,
      <GatesSettingsPanel settings={settings} onChange={vi.fn()} testCommand={testCommand} />
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.screenshot({ path: `${SHOTS}/gates-settings-390.png` });
  });
});

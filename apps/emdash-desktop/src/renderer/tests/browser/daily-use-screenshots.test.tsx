import '@emdash/ui/style.css';
import { ok } from '@emdash/shared';
import { createEventStreamHost } from '@emdash/wire/live';
import { createInProcessWire, defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { agentsContract, agentsDomain } from '@core/features/agents/api/contract';
import {
  brainContract,
  brainDomain,
  type BrainDispatcherView,
  type BrainJobView,
  type BrainSessionView,
} from '@core/features/brain/api';
import { BrainDrawer } from '@core/features/brain/contributions/lanes-drawer';
import type { Lane } from '@core/features/lanes/api';
import { AddLaneFields } from '@core/features/lanes/browser/grid/add-lane-form';
import { LaneHeader } from '@core/features/lanes/browser/grid/lane-header';
import {
  packsContract,
  packsDomain,
  type PackSummary,
  type PacksListing,
} from '@core/features/packs/api';
import { PacksPanel } from '@core/features/packs/browser/packs-view';
import { routingContract, routingDomain } from '@core/features/routing/api';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';

// First renders of the daily-use fixes (lane run mode, the add-lane role picker, pack secrets,
// the Brain drawer's Plan button) with the app's real CSS, written to docs/screenshots. Opt-in,
// so ordinary runs never touch tracked files. Compile the stylesheet into the untracked
// __generated__/daily-tailwind.css first (features/gates/README.md, "Screenshots").
import.meta.glob('./__generated__/daily-tailwind.css', { eager: true });

const SHOTS = '../../../../../../docs/screenshots';

// One wire for the whole file: the brain hooks cache their remotes per module. The agents
// domain serves only what the lane header calls (its full contract has jobs that need handlers).
const contract = defineContract({
  [agentsDomain]: defineContract({ hooksStatus: agentsContract.hooksStatus }),
  [brainDomain]: brainContract,
  [packsDomain]: packsContract,
  [routingDomain]: routingContract,
});

const DISPATCHER: BrainDispatcherView = {
  paused: false,
  stopLatched: false,
  laneModes: { 'lane-a': 'unattended' },
  activeRuns: 1,
  gatesConnected: true,
  unattendedBudgets: { wallClockMs: 30 * 60_000, maxTurns: 60 },
};

const SESSION: BrainSessionView = {
  brainId: 'b1',
  projectId: 'p1',
  taskId: 't-b1',
  conversationId: 'c-b1',
  title: 'Brain 1',
  status: 'running',
  error: null,
};

function job(id: string, title: string, state: BrainJobView['state']): BrainJobView {
  return {
    id,
    projectId: 'p1',
    title,
    state,
    laneId: state === 'ready' ? null : 'lane-a',
    attempts: state === 'verifying' ? 1 : 0,
    reason: null,
    gates: ['tests', 'reviewer'],
    createdByBrain: 'b1',
    updatedAt: 1,
  };
}

const JOBS = [
  job('j1', 'Scaffold the pricing page', 'done'),
  job('j2', 'Wire the quote form', 'running'),
  job('j3', 'Add form validation', 'verifying'),
  job('j4', 'Write the FAQ copy', 'ready'),
];

const CODING_PACK: PackSummary = {
  id: 'coding',
  version: '0.1.0',
  title: 'Coding',
  description: 'Build, review and ship code.',
  license: 'Apache-2.0',
  source: 'bundled',
  enabled: true,
  roles: [
    { id: 'builder', title: 'Builder', kind: 'code' },
    { id: 'ui-builder', title: 'UI builder', kind: 'ui' },
    { id: 'reviewer', title: 'Reviewer', kind: 'code' },
  ],
  mcpServers: [],
  catalogLinks: [],
  skills: [],
  gates: ['tests', 'reviewer'],
  settings: [],
  disclosures: [],
  secrets: [],
};

const SEO_PACK: PackSummary = {
  ...CODING_PACK,
  id: 'seo',
  title: 'SEO audit',
  description: 'A small agency team for SEO and AI-visibility audits.',
  roles: [{ id: 'seo-lead', title: 'SEO lead', kind: 'seo' }],
  gates: ['seo-evidence'],
  secrets: [
    {
      name: 'GOOGLE_ACCESS_TOKEN',
      description: 'A Google OAuth access token for Search Console and GA4.',
      howToGet: 'Mint a fresh one from a service account added to the property.',
      optional: false,
      present: true,
      location: 'the app keychain (ninebrains.pack.GOOGLE_ACCESS_TOKEN)',
      storedInApp: true,
    },
    {
      name: 'BING_API_KEY',
      description: 'Adds the Bing Webmaster tools to aeo-search.',
      howToGet: 'Bing Webmaster Tools → Settings → API access → API key.',
      optional: true,
      present: false,
      location: 'the app keychain (ninebrains.pack.BING_API_KEY)',
      storedInApp: false,
    },
  ],
};

let listing: PacksListing = { packs: [], errors: [] };

function lane(overrides: Partial<Lane>): Lane {
  return {
    laneId: 'lane-a',
    projectId: 'p1',
    taskId: 't1',
    conversationId: 'c1',
    provider: 'claude',
    model: null,
    accountLabel: null,
    browserId: 'lane-lane-a',
    asleep: false,
    conversationReady: true,
    tabId: 'tab-1',
    slot: 0,
    session: 'running',
    status: 'running',
    projectName: 'acme-site',
    branch: 'lanes/3f9a2c1b',
    error: null,
    ...overrides,
  };
}

function LaneShell({
  lane: shown,
  text,
  height = 'h-56',
}: {
  lane: Lane;
  text: string;
  height?: string;
}) {
  return (
    <div
      className={`@container flex ${height} min-w-0 flex-col overflow-hidden rounded-md border border-border`}
    >
      <LaneHeader
        lane={shown}
        status={shown.status}
        maximized={false}
        browserOpen={false}
        sidePanelOpen={false}
        onToggleBrowser={() => {}}
        onToggleSidePanel={() => {}}
        onToggleMaximize={() => {}}
      />
      <div className="flex-1 bg-background p-3 font-mono text-xs text-foreground-muted">{text}</div>
    </div>
  );
}

function Lanes() {
  return (
    <div className="grid h-full grid-cols-1 content-start gap-2 p-2 md:grid-cols-2">
      <LaneShell
        lane={lane({ runMode: 'unattended' })}
        text="Brain job j2 runs headless with claude -p. This terminal is idle."
      />
      <LaneShell
        lane={lane({
          laneId: 'lane-b',
          slot: 1,
          provider: 'codex',
          status: 'idle',
          branch: 'lanes/8e21d0aa',
        })}
        text="› Ready for the next job."
      />
    </div>
  );
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe.skipIf(!import.meta.env.VITE_DAILY_SCREENSHOTS)('daily-use screenshots', () => {
  let wire: { connection: unknown; dispose: () => Promise<void> };
  let host: HTMLDivElement;
  let root: Root;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  beforeAll(() => {
    wire = createInProcessWire(
      contract,
      {
        [agentsDomain]: {
          hooksStatus: async () => ok({ state: 'installed' as const, resolvedRoot: '/home' }),
        },
        [brainDomain]: {
          overview: expose(contract[brainDomain].overview, {
            unread: cell({ 'lane:lane-b': 2 }),
            sessions: cell([SESSION]),
            dispatcher: cell(DISPATCHER),
          }),
          project: expose(contract[brainDomain].project, {
            jobs: () => cell(JOBS),
            done: () => cell([]),
            notes: () => cell([]),
          }),
          lanePanel: expose(contract[brainDomain].lanePanel, {
            jobs: () => cell([]),
            done: () => cell([]),
            notes: () => cell([]),
          }),
          events: createEventStreamHost(contract[brainDomain].events),
          setLaneMode: async () => ok(undefined),
        },
        [packsDomain]: {
          list: async () => listing,
          setEnabled: async () => ok({ enabledPackIds: [] }),
          setSecret: async () => ok(undefined),
          clearSecret: async () => ok(undefined),
        },
        [routingDomain]: {
          listProfiles: async () => ({ enabled: true, profiles: [], vendors: [] }),
        },
        // Partial impls: only the paths these renders call.
      } as never,
      { validate: 'full' }
    );
    resetWireConnection();
    seedWireConnection(async () => wire.connection as never);
  });

  afterAll(async () => {
    resetWireConnection();
    await wire.dispose();
  });

  beforeEach(() => {
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
  });

  async function show(theme: 'emlight' | 'emdark', width: number, height: number, ui: ReactNode) {
    await page.viewport(width, height);
    document.documentElement.className = theme;
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme={theme} onThemeChange={vi.fn()}>
            <div className={`${theme} h-full overflow-hidden bg-background text-foreground`}>
              {ui}
            </div>
          </ThemeProvider>
        </QueryClientProvider>
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const clickEl = async (selector: string) => {
    const el = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(selector);
      if (!found) throw new Error(`no ${selector}`);
      return found;
    });
    await act(async () => el.click());
    await settle();
  };

  it('lane run mode, light, 1440', async () => {
    await show('emlight', 1440, 520, <Lanes />);
    await vi.waitFor(() => {
      if (!document.querySelector('[data-mode="unattended"]')) throw new Error('not rendered');
    });
    await page.screenshot({ path: `${SHOTS}/lanes-run-mode-1440.png` });
  });

  it('lane run mode, the confirmation, light, 1440', async () => {
    await show('emlight', 1440, 520, <Lanes />);
    await clickEl('[data-mode="attended"]');
    await page.screenshot({ path: `${SHOTS}/lanes-run-mode-confirm-1440.png` });
  });

  it('lane run mode, dark, 390', async () => {
    await show('emdark', 390, 520, <Lanes />);
    await page.screenshot({ path: `${SHOTS}/lanes-run-mode-390.png` });
  });

  const addLane = (
    <div className="flex h-full items-start justify-center p-6">
      <div className="h-[28rem] w-full max-w-[44rem] rounded-md border border-border">
        <AddLaneFields
          tabId="tab-1"
          slot={2}
          projects={[
            { id: 'p1', name: 'acme-site', type: 'local' },
            { id: 'p2', name: 'billing-api', type: 'local' },
          ]}
          installed={['claude', 'codex']}
        />
      </div>
    </div>
  );

  // The 1440 shot: a real lane grid cell (as it renders in the app), not a
  // small card afloat on an oversized canvas.
  const addLaneGrid = (
    <div className="grid h-full grid-cols-1 content-start gap-2 p-2 md:grid-cols-2">
      <LaneShell
        lane={lane({ runMode: 'unattended' })}
        text="Brain job j2 runs headless with claude -p. This terminal is idle."
        height="h-[32rem]"
      />
      <div className="@container flex h-[32rem] min-w-0 flex-col overflow-hidden rounded-md border border-border">
        <AddLaneFields
          tabId="tab-1"
          slot={2}
          projects={[
            { id: 'p1', name: 'acme-site', type: 'local' },
            { id: 'p2', name: 'billing-api', type: 'local' },
          ]}
          installed={['claude', 'codex']}
        />
      </div>
    </div>
  );

  it('add lane with a role picked, light, 1440', async () => {
    listing = { packs: [CODING_PACK], errors: [] };
    await show('emlight', 1440, 560, addLaneGrid);
    await clickEl('[aria-label="Role"]');
    const builder = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
        option.textContent?.includes('Builder (Coding)')
      );
      if (!found) throw new Error('no Builder option');
      return found;
    });
    await act(async () => builder.click());
    await settle();
    await page.screenshot({ path: `${SHOTS}/lanes-add-lane-role-1440.png` });
  });

  it('add lane with a role, dark, 390', async () => {
    listing = { packs: [CODING_PACK], errors: [] };
    await show('emdark', 390, 640, addLane);
    await clickEl('[aria-label="Role"]');
    await page.screenshot({ path: `${SHOTS}/lanes-add-lane-role-390.png` });
  });

  const packs = (
    <div className="h-full overflow-y-auto p-6">
      <PacksPanel projects={[{ id: 'p1', name: 'acme-site' }]} />
    </div>
  );

  it('pack secrets, light, 1440', async () => {
    listing = { packs: [{ ...SEO_PACK, enabled: true }], errors: [] };
    await show('emlight', 1440, 1500, packs);
    await vi.waitFor(() => {
      if (!document.querySelector('input[aria-label="New value for BING_API_KEY"]'))
        throw new Error('no secrets yet');
    });
    await page.screenshot({ path: `${SHOTS}/packs-secrets-1440.png` });
  });

  it('pack secrets, dark, 390', async () => {
    listing = { packs: [{ ...SEO_PACK, enabled: true }], errors: [] };
    await show('emdark', 390, 1400, packs);
    await vi.waitFor(() => {
      if (!document.querySelector('input[aria-label="New value for BING_API_KEY"]'))
        throw new Error('no secrets yet');
    });
    await page.screenshot({ path: `${SHOTS}/packs-secrets-390.png` });
  });

  it('Brain drawer with the Plan button, light, 1440', async () => {
    await show(
      'emlight',
      1440,
      900,
      <div className="flex h-full">
        <div className="flex-1 p-2">
          <Lanes />
        </div>
        <div className="w-[30rem] border-l border-border">
          <BrainDrawer
            projects={[{ projectId: 'p1', name: 'acme-site' }]}
            lanes={[
              { laneId: 'lane-a', label: 'Lane 1' },
              { laneId: 'lane-b', label: 'Lane 2' },
            ]}
            renderTerminal={() => (
              <div className="h-full bg-background p-3 font-mono text-xs text-foreground-muted">
                Brain 1 · planning the pricing page in jobs j1–j4
              </div>
            )}
          />
        </div>
      </div>
    );
    await vi.waitFor(() => {
      if (!document.querySelector('[data-testid="brain-open-planner"]'))
        throw new Error('not rendered');
    });
    await page.screenshot({ path: `${SHOTS}/brain-drawer-plan-1440.png` });
  });
});

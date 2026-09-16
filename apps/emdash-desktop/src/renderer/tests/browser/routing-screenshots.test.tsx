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
import { brainContract, brainDomain, type BrainDispatcherView } from '@core/features/brain/api';
import type { Lane } from '@core/features/lanes/api';
import { LaneHeader } from '@core/features/lanes/browser/grid/lane-header';
import {
  routingContract,
  routingDomain,
  UNPRICED,
  type ModelProfileView,
  type ProfilesListing,
  type Vendor,
} from '@core/features/routing/api';
import { ModelsSettingsPanel } from '@core/features/routing/browser/models-settings-view';
import { ThemeProvider } from '@core/primitives/theme/browser/theme-provider';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';

// First renders of Settings → Models and the lane header's routing badge with the app's real
// CSS, written to docs/screenshots/routing-*.png. Opt-in, so ordinary runs never touch tracked
// files. Compile the stylesheet into the untracked __generated__/routing-tailwind.css first
// (features/gates/README.md, "Screenshots").
import.meta.glob('./__generated__/routing-tailwind.css', { eager: true });

const SHOTS = '../../../../../../docs/screenshots';

const vendor = (v: Omit<Vendor, 'termsUrl' | 'reviewedAt'>): Vendor => ({
  termsUrl: null,
  reviewedAt: '2026-09-12',
  ...v,
});

const VENDORS: Vendor[] = [
  vendor({
    id: 'anthropic',
    label: 'Anthropic API',
    kinds: ['anthropic-api'],
    protocols: ['anthropic'],
    hosts: ['api.anthropic.com'],
    baseUrls: { anthropic: 'https://api.anthropic.com' },
    docsUrl: 'https://code.claude.com/docs/en/llm-gateway',
    note: "First-party. The user's own Anthropic API key, billed per token.",
  }),
  vendor({
    id: 'openrouter',
    label: 'OpenRouter',
    kinds: ['anthropic-compatible'],
    protocols: ['anthropic'],
    hosts: ['openrouter.ai'],
    baseUrls: { anthropic: 'https://openrouter.ai/api' },
    docsUrl: 'https://openrouter.ai/docs/guides/guides/claude-code-integration',
  }),
  vendor({
    id: 'ollama',
    label: 'Ollama (this machine)',
    kinds: ['local'],
    protocols: ['anthropic', 'openai-responses'],
    hosts: ['127.0.0.1', 'localhost'],
    baseUrls: {
      anthropic: 'http://127.0.0.1:11434',
      'openai-responses': 'http://127.0.0.1:11434/v1',
    },
    docsUrl: 'https://docs.ollama.com/api/anthropic-compatibility',
  }),
];

function profile(overrides: Partial<ModelProfileView> & Pick<ModelProfileView, 'id' | 'label'>) {
  return {
    kind: 'anthropic-api',
    vendorId: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    tierModels: {},
    tier: 'standard',
    price: UNPRICED,
    contextWindow: null,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    hasKey: true,
    unsupported: false,
    priced: false,
    ...overrides,
  } satisfies ModelProfileView;
}

const PROFILES: ModelProfileView[] = [
  profile({
    id: 'p-ollama',
    label: 'Ollama Qwen coder',
    kind: 'local',
    vendorId: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3-coder:30b',
    tier: 'cheap',
    price: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: null, cacheWritePerMTok: null },
    hasKey: false,
    unsupported: true,
    priced: true,
  }),
  profile({
    id: 'p-or',
    label: 'OpenRouter GLM',
    kind: 'anthropic-compatible',
    vendorId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api',
    model: 'z-ai/glm-5',
    tier: 'cheap',
    unsupported: true,
  }),
  profile({
    id: 'p-ant',
    label: 'Anthropic API key',
    model: 'claude-sonnet-5',
    tier: 'strong',
    price: { inPerMTok: 3, outPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
    priced: true,
  }),
];

const LISTING: ProfilesListing = { enabled: true, profiles: PROFILES, vendors: VENDORS };

const contract = defineContract({
  [agentsDomain]: defineContract({ hooksStatus: agentsContract.hooksStatus }),
  [brainDomain]: brainContract,
  [routingDomain]: routingContract,
});

const DISPATCHER: BrainDispatcherView = {
  paused: false,
  stopLatched: false,
  laneModes: {},
  activeRuns: 0,
  gatesConnected: true,
  unattendedBudgets: { wallClockMs: 30 * 60_000, maxTurns: 60 },
};

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

function LaneShell({ lane: shown, text }: { lane: Lane; text: string }) {
  return (
    <div className="@container flex h-56 min-w-0 flex-col overflow-hidden rounded-md border border-border">
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
        lane={lane({ subagentModel: 'haiku', authProfileId: 'p-or' })}
        text="Subagents run on Haiku. The lane runs on the OpenRouter key."
      />
      <LaneShell
        lane={lane({ laneId: 'lane-b', slot: 1, status: 'idle', branch: 'lanes/8e21d0aa' })}
        text="› Ready for the next job."
      />
      <LaneShell
        lane={lane({
          laneId: 'lane-c',
          slot: 2,
          provider: 'codex',
          status: 'idle',
          branch: 'lanes/51c7e0f2',
        })}
        text="› Codex on your own login."
      />
    </div>
  );
}

const noop = () => {};
const CONNECTED = {
  status: 'ok' as const,
  httpStatus: 200,
  message: 'The server listed 12 models.',
  modelCount: 12,
};

function Models({ listing }: { listing: ProfilesListing }) {
  return (
    <div className="h-full overflow-y-auto">
      <ModelsSettingsPanel
        listing={listing}
        tests={{ 'p-ant': CONNECTED }}
        onSaveProfile={async () => true}
        onTest={noop}
        onSetKey={async () => true}
        onClearKey={noop}
        onDelete={async () => {}}
      />
    </div>
  );
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe.skipIf(!import.meta.env.VITE_ROUTING_SCREENSHOTS)('routing screenshots', () => {
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
            unread: cell({}),
            sessions: cell([]),
            dispatcher: cell(DISPATCHER),
          }),
          project: expose(contract[brainDomain].project, {
            jobs: () => cell([]),
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
        [routingDomain]: { listProfiles: async () => LISTING },
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

  it('models, light, 1440', async () => {
    await show('emlight', 1440, 1300, <Models listing={LISTING} />);
    await page.screenshot({ path: `${SHOTS}/routing-models-1440.png` });
  });

  it('models, dark, 390', async () => {
    await show('emdark', 390, 2000, <Models listing={LISTING} />);
    await page.screenshot({ path: `${SHOTS}/routing-models-390.png` });
  });

  it('models, profiles off, light, 1440', async () => {
    await show(
      'emlight',
      1440,
      300,
      <Models listing={{ enabled: false, profiles: [], vendors: [] }} />
    );
    await page.screenshot({ path: `${SHOTS}/routing-models-disabled-1440.png` });
  });

  it('lane header, the routing popover open, light, 1440', async () => {
    await show('emlight', 1440, 560, <Lanes />);
    const badge = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-testid="lane-routing"]');
      if (!found?.textContent?.includes('OpenRouter GLM')) throw new Error('no badge yet');
      return found;
    });
    await act(async () => badge.click());
    await vi.waitFor(() => {
      if (!document.querySelector('[aria-label="Runs on"]')) throw new Error('no popover yet');
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.screenshot({ path: `${SHOTS}/routing-lane-header-1440.png` });
  });

  it('lane header, dark, 390', async () => {
    await show('emdark', 390, 760, <Lanes />);
    await page.screenshot({ path: `${SHOTS}/routing-lane-header-390.png` });
  });
});

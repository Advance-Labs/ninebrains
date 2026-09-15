import { ok } from '@emdash/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import {
  routingContract,
  routingDomain,
  UNPRICED,
  type ModelProfileView,
  type ProfilesListing,
  type Vendor,
} from '../api';
import { ModelsSettingsPanel, ModelsSettingsView } from './models-settings-view';

// The reviewer pin is a plain app setting (SEC-42); this view's own tests are about profiles,
// so the reviewer-pin hook is mocked like every other `useAppSettingsKey` consumer's browser test.
vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { reviewerProfileId: null },
    isLoading: false,
    update: vi.fn(),
  }),
}));

// Settings → Models through the routing slice's own client, seeded with `seedSliceWire`.

const ANTHROPIC: Vendor = {
  id: 'anthropic',
  label: 'Anthropic API',
  kinds: ['anthropic-api'],
  protocols: ['anthropic'],
  hosts: ['api.anthropic.com'],
  baseUrls: { anthropic: 'https://api.anthropic.com' },
  docsUrl: 'https://code.claude.com/docs/en/llm-gateway',
  termsUrl: null,
  reviewedAt: '2026-09-12',
};

const OPENROUTER_PROFILE: ModelProfileView = {
  id: 'p-or',
  label: 'OpenRouter GLM',
  kind: 'anthropic-compatible',
  vendorId: 'openrouter',
  protocol: 'anthropic',
  baseUrl: 'https://openrouter.ai/api',
  model: 'z-ai/glm-5',
  tierModels: {},
  tier: 'cheap',
  price: UNPRICED,
  contextWindow: null,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  hasKey: true,
  unsupported: true,
  priced: false,
};

const KEY = 'sk-ant-api03-DO-NOT-SHOW-1234567890';

const noop = () => {};

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Settings → Models', () => {
  let listing: ProfilesListing;
  const saved: unknown[] = [];
  const keys: unknown[] = [];
  let handle: { dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    saved.length = 0;
    keys.length = 0;
    listing = { enabled: true, profiles: [], vendors: [ANTHROPIC] };
    handle = seedSliceWire(routingDomain, routingContract, {
      listProfiles: async () => listing,
      saveProfile: async (input: unknown) => {
        saved.push(input);
        return ok({ profileId: 'p-new' });
      },
      setProfileKey: async (input: unknown) => {
        keys.push(input);
        return ok(undefined);
      },
      clearProfileKey: async () => ok(undefined),
      deleteProfile: async () => ok(undefined),
      testConnection: async () =>
        ok({ status: 'ok' as const, httpStatus: 200, message: 'Listed 3 models.', modelCount: 3 }),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    await handle.dispose();
  });

  it('shows only the notice when profiles are off', async () => {
    listing = { enabled: false, profiles: [], vendors: [] };
    await act(async () => root.render(<ModelsSettingsView />));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Model profiles are off in this build.')
    );
    expect(container.querySelector('form[aria-label="Add profile"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('[data-testid="model-profile"]')).toBeNull();
  });

  it('saves a profile, stores the key write-only and clears the field', async () => {
    await act(async () => root.render(<ModelsSettingsView />));
    const keyInput = await vi.waitFor(() => {
      const found = container.querySelector<HTMLInputElement>('input[aria-label="API key"]');
      if (!found) throw new Error('no key field');
      return found;
    });
    expect(keyInput.type).toBe('password');
    expect(keyInput.autocomplete).toBe('off');
    expect(keyInput.value).toBe('');

    act(() => {
      setInput(
        container.querySelector<HTMLInputElement>('input[aria-label="Model"]')!,
        'claude-sonnet-5'
      );
      setInput(keyInput, KEY);
    });
    await act(async () =>
      container.querySelector<HTMLFormElement>('form[aria-label="Add profile"]')!.requestSubmit()
    );

    await vi.waitFor(() => expect(keys).toEqual([{ profileId: 'p-new', key: KEY }]));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      kind: 'anthropic-api',
      vendorId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5',
    });
    expect(JSON.stringify(saved[0])).not.toContain(KEY);
    expect(keyInput.value).toBe('');
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('flags a non-Anthropic host and a profile with no prices', async () => {
    await act(async () =>
      root.render(
        <ModelsSettingsPanel
          listing={{ enabled: true, profiles: [OPENROUTER_PROFILE], vendors: [ANTHROPIC] }}
          onSaveProfile={async () => true}
          onTest={noop}
          onSetKey={async () => true}
          onClearKey={noop}
          onDelete={async () => {}}
        />
      )
    );
    const row = container.querySelector('[data-testid="model-profile"]')!;
    expect(row.textContent).toContain('Not supported by Anthropic');
    expect(row.textContent).toContain('Unpriced');
    expect(row.textContent).toContain('Key set');
    expect(row.textContent).toContain('openrouter.ai');
  });

  it('shows the connection test result inline', async () => {
    listing = { enabled: true, profiles: [OPENROUTER_PROFILE], vendors: [ANTHROPIC] };
    await act(async () => root.render(<ModelsSettingsView />));
    const test = await vi.waitFor(() => {
      const found = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Test connection'
      );
      if (!found) throw new Error('no test button');
      return found;
    });
    await act(async () => test.click());
    await vi.waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Connected: Listed 3 models.'
      )
    );
  });
});

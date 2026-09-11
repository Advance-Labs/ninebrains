import { ok } from '@emdash/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import { packsContract, packsDomain, type PackSummary, type PacksListing } from '../api';
import { PacksPanel } from './packs-view';

// The packs slice renders against a fake controller seeded through
// `seedSliceWire`: no renderer host, no Electron, no other slices.

function pack(overrides: Partial<PackSummary> = {}): PackSummary {
  return {
    id: 'seo',
    version: '0.1.0',
    title: 'SEO audit',
    description: 'An SEO audit team.',
    license: 'Apache-2.0',
    source: 'bundled',
    enabled: false,
    roles: [{ id: 'seo-lead', title: 'SEO lead', kind: 'seo' }],
    mcpServers: [
      {
        name: 'aeo-search',
        description: 'Search data.',
        license: 'Apache-2.0',
        optional: false,
        homepage: 'https://github.com/Advance-Labs/aeo-toolkit',
        transport: 'http',
      },
    ],
    catalogLinks: [],
    skills: [
      { id: 'seo-traffic-drop', installId: 'nb-seo-seo-traffic-drop', source: 'aeo-toolkit' },
    ],
    gates: ['seo-evidence'],
    settings: [],
    disclosures: [],
    secrets: [
      {
        name: 'GOOGLE_ACCESS_TOKEN',
        description: 'Google token.',
        howToGet: 'Mint one from a service account.',
        optional: false,
        present: false,
        location: 'environment variable NINEBRAINS_SECRET_GOOGLE_ACCESS_TOKEN',
      },
    ],
    ...overrides,
  };
}

describe('packs settings through the wire seam', () => {
  const listCalls: unknown[] = [];
  const setCalls: unknown[] = [];
  let listing: PacksListing;
  let handle: { dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listCalls.length = 0;
    setCalls.length = 0;
    listing = {
      packs: [pack()],
      errors: [
        { source: 'user', packId: 'broken', location: '/packs/broken', message: 'bad json' },
      ],
    };
    handle = seedSliceWire(packsDomain, packsContract, {
      list: async (input: unknown) => {
        listCalls.push(input);
        return listing;
      },
      setEnabled: async (input: { packId: string; enabled: boolean }) => {
        setCalls.push(input);
        return ok({ enabledPackIds: input.enabled ? [input.packId] : [] });
      },
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

  it('lists packs for the first project, with licence, warnings and load errors', async () => {
    await act(async () => {
      root.render(<PacksPanel projects={[{ id: 'p1', name: 'Site' }]} />);
    });
    await vi.waitFor(() => expect(container.textContent).toContain('SEO audit'));
    expect(listCalls).toEqual([{ projectId: 'p1' }]);
    expect(container.textContent).toContain('Apache-2.0');
    expect(container.textContent).toContain('Missing secrets');
    expect(container.textContent).toContain('NINEBRAINS_SECRET_GOOGLE_ACCESS_TOKEN');
    expect(container.textContent).toContain('Pack broken could not be loaded');
  });

  it('toggles a pack for the selected project', async () => {
    await act(async () => {
      root.render(<PacksPanel projects={[{ id: 'p1', name: 'Site' }]} />);
    });
    const toggle = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('[aria-label="Enable the SEO audit pack"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await act(async () => {
      toggle.click();
    });
    await vi.waitFor(() =>
      expect(setCalls).toEqual([{ projectId: 'p1', packId: 'seo', enabled: true }])
    );
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('asks for a project before packs can be enabled', async () => {
    await act(async () => {
      root.render(<PacksPanel projects={[]} />);
    });
    await vi.waitFor(() => expect(container.textContent).toContain('Add a project'));
    expect(listCalls).toEqual([{ projectId: null }]);
  });
});

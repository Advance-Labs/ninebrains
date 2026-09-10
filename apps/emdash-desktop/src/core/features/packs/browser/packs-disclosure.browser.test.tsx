import { ok } from '@emdash/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import { packsContract, packsDomain, type PackSummary } from '../api';
import { PacksPanel } from './packs-view';

const DISCLOSURE = "Your Google access token goes to Advance Labs' hosted endpoint.";

const seo: PackSummary = {
  id: 'seo',
  version: '0.1.0',
  title: 'SEO audit',
  description: 'An SEO audit team. Off until you enable it.',
  license: 'Apache-2.0',
  source: 'bundled',
  enabled: false,
  roles: [{ id: 'seo-lead', title: 'SEO lead', kind: 'seo' }],
  mcpServers: [],
  catalogLinks: [],
  skills: [],
  gates: ['seo-evidence'],
  secrets: [],
  settings: [
    {
      name: 'AEO_MCP_BASE_URL',
      description: 'Base URL of the AEO Toolkit MCP servers.',
      default: 'https://aeo.advancelabs.dev/api/mcp',
      location: 'environment variable NINEBRAINS_SECRET_AEO_MCP_BASE_URL',
      overridden: false,
    },
  ],
  disclosures: [DISCLOSURE],
};

describe('packs that send data to a hosted service', () => {
  const setCalls: unknown[] = [];
  let handle: { dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setCalls.length = 0;
    handle = seedSliceWire(packsDomain, packsContract, {
      list: async () => ({ packs: [seo], errors: [] }),
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

  const buttonNamed = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === name);

  async function renderAndToggle() {
    await act(async () => {
      root.render(<PacksPanel projects={[{ id: 'p1', name: 'Site' }]} />);
    });
    const toggle = await vi.waitFor(() => {
      const el = container.querySelector<HTMLElement>('[aria-label="Enable the SEO audit pack"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(container.textContent).toContain('Data sent to a hosted service');
    expect(container.textContent).toContain(DISCLOSURE);
    expect(container.textContent).toContain(
      'Using the default, https://aeo.advancelabs.dev/api/mcp'
    );
    await act(async () => {
      toggle.click();
    });
    return toggle;
  }

  it('asks for confirmation before enabling, and enables only on confirm', async () => {
    const toggle = await renderAndToggle();
    await vi.waitFor(() => expect(container.textContent).toContain('Enable the SEO audit pack?'));
    expect(setCalls).toEqual([]);

    await act(async () => {
      buttonNamed('Enable and send this data')?.click();
    });
    await vi.waitFor(() =>
      expect(setCalls).toEqual([{ projectId: 'p1', packId: 'seo', enabled: true }])
    );
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('stays off when the confirmation is cancelled', async () => {
    const toggle = await renderAndToggle();
    await vi.waitFor(() => expect(buttonNamed('Cancel')).toBeDefined());
    await act(async () => {
      buttonNamed('Cancel')?.click();
    });
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain('Enable the SEO audit pack?')
    );
    expect(setCalls).toEqual([]);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});

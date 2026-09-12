import { err, ok } from '@emdash/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedSliceWire } from '@core/primitives/wire/browser/testing';
import { packsContract, packsDomain, type PackSummary, type PacksListing } from '../api';
import { PacksPanel } from './packs-view';

// The packs slice renders against a fake controller seeded through
// `seedSliceWire`: no renderer host, no Electron, no other slices.

const SECRET_VALUE = 'ya29.super-secret-google-token';

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
        storedInApp: false,
      },
    ],
    ...overrides,
  };
}

describe('packs settings through the wire seam', () => {
  const listCalls: unknown[] = [];
  const setCalls: unknown[] = [];
  const secretCalls: Array<{ op: 'set' | 'clear'; name: string; value?: string }> = [];
  let listing: PacksListing;
  let failNextSet = false;
  let handle: { dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listCalls.length = 0;
    setCalls.length = 0;
    secretCalls.length = 0;
    failNextSet = false;
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
      // A fake main: records the call and, like the real one, answers set/missing only.
      setSecret: async ({ name, value }: { name: string; value: string }) => {
        secretCalls.push({ op: 'set', name, value });
        if (failNextSet) {
          return err({
            type: 'secret-store' as const,
            message: `Could not store ${name}: Secure secret storage is unavailable on this system.`,
          });
        }
        listing = {
          ...listing,
          packs: [
            pack({
              secrets: [{ ...pack().secrets[0]!, present: true, storedInApp: true }],
            }),
          ],
        };
        return ok(undefined);
      },
      clearSecret: async ({ name }: { name: string }) => {
        secretCalls.push({ op: 'clear', name });
        listing = { ...listing, packs: [pack()] };
        return ok(undefined);
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

  async function typeSecret(value: string) {
    const input = await vi.waitFor(() => {
      const el = container.querySelector<HTMLInputElement>(
        'input[aria-label="New value for GOOGLE_ACCESS_TOKEN"]'
      );
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  }

  const saveButton = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;

  it('writes a secret once and never shows it back (write-only)', async () => {
    await act(async () => {
      root.render(<PacksPanel projects={[{ id: 'p1', name: 'Site' }]} />);
    });
    const input = await typeSecret(SECRET_VALUE);
    await act(async () => saveButton().click());

    await vi.waitFor(() =>
      expect(secretCalls).toEqual([{ op: 'set', name: 'GOOGLE_ACCESS_TOKEN', value: SECRET_VALUE }])
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Set in the app keychain.'));
    // The field empties after saving, and the value is nowhere in the page.
    expect(input.value).toBe('');
    expect(container.innerHTML).not.toContain(SECRET_VALUE);
    expect(container.textContent).not.toContain('Missing secrets');

    const clear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear GOOGLE_ACCESS_TOKEN"]'
    )!;
    await act(async () => clear.click());
    await vi.waitFor(() =>
      expect(secretCalls.at(-1)).toEqual({ op: 'clear', name: 'GOOGLE_ACCESS_TOKEN' })
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Missing secrets'));
  });

  it('keeps the draft and shows the store error when the keychain refuses', async () => {
    failNextSet = true;
    await act(async () => {
      root.render(<PacksPanel projects={[{ id: 'p1', name: 'Site' }]} />);
    });
    const input = await typeSecret(SECRET_VALUE);
    await act(async () => saveButton().click());
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Secure secret storage is unavailable')
    );
    // The error names the secret, never its value.
    expect(container.textContent).not.toContain(SECRET_VALUE);
    expect(input.value).toBe(SECRET_VALUE);
  });
});

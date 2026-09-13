import { ok } from '@emdash/shared';
import { createInProcessWire, defineContract } from '@emdash/wire/rpc';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lanesContract, lanesDomain } from '@core/features/lanes/api';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';
import {
  routingContract,
  routingDomain,
  UNPRICED,
  type ModelProfileView,
  type ProfilesListing,
} from '../api';
import { LaneRoutingControl, LaneRoutingFields } from './lane-routing';

// The lane header's routing control and the add-lane fields, against fake lanes and routing
// domains on one in-process wire.

const contract = defineContract({
  [lanesDomain]: defineContract({ setLaneRouting: lanesContract.setLaneRouting }),
  [routingDomain]: routingContract,
});

function profile(
  id: string,
  label: string,
  protocol: ModelProfileView['protocol']
): ModelProfileView {
  return {
    id,
    label,
    kind: protocol === 'anthropic' ? 'anthropic-api' : 'openai-api',
    vendorId: protocol === 'anthropic' ? 'anthropic' : 'openai',
    protocol,
    baseUrl: protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
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
  };
}

const PROFILES = [
  profile('p-ant', 'Anthropic key', 'anthropic'),
  profile('p-oai', 'OpenAI key', 'openai-responses'),
];

async function waitForEl<T extends Element>(selector: string, text?: string): Promise<T> {
  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<T>(selector)].find(
      (el) => text === undefined || el.textContent?.trim() === text
    );
    if (!found) throw new Error(`no ${selector} ${text ?? ''}`);
    return found;
  });
}

async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}

describe('lane routing controls', () => {
  let listing: ProfilesListing;
  let listCalls = 0;
  const routed: unknown[] = [];
  let wire: { connection: unknown; dispose: () => Promise<void> };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    routed.length = 0;
    listCalls = 0;
    listing = { enabled: true, profiles: PROFILES, vendors: [] };
    wire = createInProcessWire(
      contract,
      {
        [lanesDomain]: {
          setLaneRouting: async (input: unknown) => {
            routed.push(input);
            return ok(undefined);
          },
        },
        [routingDomain]: {
          listProfiles: async () => {
            listCalls += 1;
            return listing;
          },
        },
        // Partial impls: only the paths these renders call.
      } as never,
      { validate: 'full' }
    );
    resetWireConnection();
    seedWireConnection(async () => wire.connection as never);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    resetWireConnection();
    await wire.dispose();
  });

  it('saves the chosen subagent tier for the lane', async () => {
    await act(async () => root.render(<LaneRoutingControl laneId="lane-a" provider="claude" />));
    expect(container.textContent).toContain('Inherit');
    await click(await waitForEl('[data-testid="lane-routing"]'));
    await click(await waitForEl('[aria-label="Subagent model"]'));
    await click(await waitForEl('[role="option"]', 'Haiku'));
    await click(await waitForEl('[data-testid="lane-routing-popover"] button', 'Save'));
    await vi.waitFor(() =>
      expect(routed).toEqual([{ laneId: 'lane-a', subagentModel: 'haiku', authProfileId: null }])
    );
  });

  it('offers only profiles that match the lane agent', async () => {
    await act(async () =>
      root.render(<LaneRoutingControl laneId="lane-a" provider="claude" authProfileId="p-ant" />)
    );
    await click(await waitForEl('[data-testid="lane-routing"]'));
    await click(await waitForEl('[aria-label="Runs on"]'));
    // Only the open listbox: a closed select can keep its options mounted.
    const option = await waitForEl('[role="option"]', 'Key: Anthropic key');
    const listbox = option.closest('[role="listbox"]')!;
    const options = [...listbox.querySelectorAll('[role="option"]')].map((o) =>
      o.textContent?.trim()
    );
    expect(options).toEqual(['Your subscription', 'Key: Anthropic key']);
  });

  it('hides the auth select when profiles are off', async () => {
    listing = { enabled: false, profiles: [], vendors: [] };
    await act(async () => root.render(<LaneRoutingControl laneId="lane-a" provider="claude" />));
    await click(await waitForEl('[data-testid="lane-routing"]'));
    await waitForEl('[data-testid="lane-routing-popover"]');
    await vi.waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2));
    expect(document.querySelector('[aria-label="Subagent model"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Runs on"]')).toBeNull();
  });

  it('says codex has no subagent model and hides the tier', async () => {
    await act(async () => root.render(<LaneRoutingControl laneId="lane-b" provider="codex" />));
    await click(await waitForEl('[data-testid="lane-routing"]'));
    await waitForEl(
      '[data-testid="lane-routing-popover"] p',
      'Codex has no subagent model setting.'
    );
    expect(document.querySelector('[aria-label="Subagent model"]')).toBeNull();
  });

  it('add-lane fields show the role default and hide auth when profiles are off', async () => {
    listing = { enabled: false, profiles: [], vendors: [] };
    await act(async () =>
      root.render(
        <LaneRoutingFields
          provider="claude"
          value={{}}
          onChange={() => {}}
          roleSubagentModel="haiku"
        />
      )
    );
    await vi.waitFor(() => expect(listCalls).toBe(1));
    expect(container.textContent).toContain('Role default: Haiku');
    expect(container.querySelector('[aria-label="Runs on"]')).toBeNull();
  });
});

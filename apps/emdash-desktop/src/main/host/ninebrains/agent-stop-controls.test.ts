import type * as fs from 'node:fs';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@emdash/shared';
import { Brain, InMemoryBrainStore } from '@ninebrains/brain-core';
import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrainService } from '@core/features/brain/node/brain-service';
import { startBrainEndpoint } from '@core/features/brain/node/endpoint';

// SEC-30: the app menu and tray STOP must work with a hung renderer. This drives a real
// BrainService from the menu and tray items with no renderer, no window and no wire at all:
// the electron mock has no BrowserWindow, and the renderer command channel is a spy.

const { built, setApplicationMenu, rendererCommand, trays } = vi.hoisted(() => ({
  built: [] as MenuItemConstructorOptions[][],
  setApplicationMenu: vi.fn(),
  rendererCommand: vi.fn(),
  trays: [] as Array<{ menus: MenuItemConstructorOptions[][] }>,
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
  readFileSync: vi.fn(() => Buffer.from('icon')),
}));

vi.mock('electron', () => ({
  app: { name: 'Ninebrains', quit: vi.fn(), showAboutPanel: vi.fn(), getVersion: () => '0.1.0' },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => {
      built.push(template);
      return template;
    }),
    setApplicationMenu,
  },
  nativeImage: {
    createEmpty: () => ({ addRepresentation: vi.fn(), setTemplateImage: vi.fn() }),
    createFromPath: () => ({ resize: vi.fn() }),
  },
  Tray: class {
    menus: MenuItemConstructorOptions[][] = [];
    constructor() {
      trays.push(this);
    }
    isDestroyed = () => false;
    destroy = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = (menu: MenuItemConstructorOptions[]) => void this.menus.push(menu);
    on = vi.fn();
  },
}));

vi.mock('@core/features/workbench/node', () => ({
  desktopHostEvents: { emit: rendererCommand },
}));
vi.mock('@main/lib/telemetry', () => ({ telemetryService: { getInstanceId: () => null } }));
vi.mock('../window', () => ({ showMainWindow: vi.fn() }));

import { setupApplicationMenu } from '../menu';
import { setTrayVisible } from '../tray';
import { brainStopControls, registerAgentStopControls } from './agent-stop-controls';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
  built.length = 0;
  trays.length = 0;
  vi.clearAllMocks();
});

async function brainService() {
  const userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'nb-stop-menu-')));
  const brain = new Brain({ store: new InMemoryBrainStore() });
  const endpoint = await startBrainEndpoint({ brain, onInternalError: () => {} });
  const supervisor = {
    run: vi.fn(),
    killAll: vi.fn(async () => {}),
    clearStop: vi.fn(),
    activeRunIds: ['run-1'],
  };
  const service = new BrainService({
    brain,
    endpoint,
    userDataDir,
    brainMcp: { execPath: '/app/Ninebrains', binPath: '/app/brain-mcp/bin.mjs' },
    lanes: {
      list: () => [],
      sendInput: async () => {},
      stop: async () => {},
      setMode: async () => {},
      subscribe: () => () => {},
      refresh: () => {},
    },
    sessions: {
      projects: { get: async () => null },
      tasks: {
        createWorktreeTask: async () => ok(undefined),
        provision: async () => ok({ path: '/x' }),
      },
      conversations: { create: async () => {}, launch: async () => {}, stop: async () => {} },
      persistence: { load: async () => [], save: async () => {} },
      newId: () => 'b1',
      onError: () => {},
    },
    supervisor,
    onError: (context, error) => {
      throw new Error(`${context}: ${String(error)}`);
    },
    dispatch: { intervalMs: 60_000, debounceMs: 1 },
  });
  service.start();
  cleanups.push(() => service.dispose());
  return { service, supervisor };
}

function item(template: MenuItemConstructorOptions[] | undefined, id: string) {
  const agents = template?.find((entry) => entry.label === 'Agents');
  const items = (agents?.submenu ?? template) as MenuItemConstructorOptions[];
  const found = items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no menu item ${id}`);
  return found;
}

// Electron ignores what a click handler returns, so the tests do too.
const click = (entry: MenuItemConstructorOptions): void =>
  void (entry.click as unknown as () => unknown)();

async function until(check: () => boolean): Promise<void> {
  const end = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('SEC-30 STOP from the main process', () => {
  it('app menu STOP latches the Brain and kills runs with no renderer involved', async () => {
    setupApplicationMenu();
    // Before the Brain exists the item is there but inert.
    expect(item(built.at(-1), 'ninebrains-stop-all').enabled).toBe(false);

    const { service, supervisor } = await brainService();
    cleanups.push(registerAgentStopControls(brainStopControls(service)));
    const menu = built.at(-1);
    expect(item(menu, 'ninebrains-stop-all')).toMatchObject({
      enabled: true,
      accelerator: expect.stringMatching(/Shift\+Backspace$/),
    });
    expect(item(menu, 'ninebrains-clear-stop').enabled).toBe(false);

    click(item(menu, 'ninebrains-stop-all'));
    // The menu rebuilds once the Brain has answered: Clear STOP goes live.
    await until(() => item(built.at(-1), 'ninebrains-clear-stop').enabled === true);
    expect(service.dispatcher.state.stopLatched).toBe(true);
    expect(supervisor.killAll).toHaveBeenCalledTimes(1);
    // The renderer command channel was never used.
    expect(rendererCommand).not.toHaveBeenCalled();

    const latchedMenu = built.at(-1);
    click(item(latchedMenu, 'ninebrains-clear-stop'));
    expect(service.dispatcher.state.stopLatched).toBe(false);
    expect(supervisor.clearStop).toHaveBeenCalledTimes(1);
    expect(item(built.at(-1), 'ninebrains-clear-stop').enabled).toBe(false);
  });

  it('Clear STOP never resumes a dispatcher the user only paused', async () => {
    const { service } = await brainService();
    cleanups.push(registerAgentStopControls(brainStopControls(service)));
    service.setDispatcherPaused(true);
    setupApplicationMenu();
    click(item(built.at(-1), 'ninebrains-clear-stop'));
    expect(service.dispatcher.state.paused).toBe(true);
  });

  it('tray STOP does the same, and the tray menu follows the latch', async () => {
    const { service, supervisor } = await brainService();
    cleanups.push(registerAgentStopControls(brainStopControls(service)));
    setTrayVisible(true);
    cleanups.push(() => setTrayVisible(false));
    const tray = trays[0]!;
    click(item(tray.menus.at(-1), 'ninebrains-stop-all'));
    await until(() => item(tray.menus.at(-1), 'ninebrains-clear-stop').enabled === true);
    expect(service.dispatcher.state.stopLatched).toBe(true);
    expect(supervisor.killAll).toHaveBeenCalledTimes(1);
    expect(rendererCommand).not.toHaveBeenCalled();
  });
});

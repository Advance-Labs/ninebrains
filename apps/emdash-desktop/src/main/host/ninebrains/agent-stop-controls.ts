import type { MenuItemConstructorOptions } from 'electron';
import { brainStopAllCommand } from '@core/features/brain/contributions/commands';
import {
  resolveEffectiveChord,
  toElectronAccelerator,
  type PlatformContext,
} from '@core/primitives/keybindings/api';

/**
 * Global STOP from the main process (SEC-30): the app menu and the tray call the Brain here
 * directly, never through the renderer, so they still work when the window has hung.
 */
export interface AgentStopControls {
  stopAll(): Promise<unknown>;
  clearStop(): unknown;
  isLatched(): boolean;
  /** Fires whenever the latch changes, whichever entry point changed it. Returns an unsubscribe. */
  onLatchChange(listener: () => void): () => void;
}

/** The slice of BrainService the controls need (structural, so tests can pass a fake). */
export interface StoppableBrain {
  stopAll(): Promise<unknown>;
  clearStop(): unknown;
  readonly dispatcher: { readonly state: { readonly stopLatched: boolean } };
  onStopChange(listener: () => void): () => void;
}

export function brainStopControls(brain: StoppableBrain): AgentStopControls {
  return {
    stopAll: () => brain.stopAll(),
    clearStop: () => brain.clearStop(),
    isLatched: () => brain.dispatcher.state.stopLatched,
    onLatchChange: (listener) => brain.onStopChange(listener),
  };
}

let controls: AgentStopControls | null = null;
let unsubscribeLatch: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A menu rebuild failing must not stop the others.
    }
  }
}

/** Called once the Brain exists. Returns the unregister for the app scope. */
export function registerAgentStopControls(next: AgentStopControls): () => void {
  unsubscribeLatch?.();
  controls = next;
  unsubscribeLatch = next.onLatchChange(notify);
  notify();
  return () => {
    if (controls !== next) return;
    unsubscribeLatch?.();
    unsubscribeLatch = null;
    controls = null;
    notify();
  };
}

/** Menus rebuild through this, so their items show the current latch. */
export function onAgentStopStateChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** STOP, answered by main. Resolves once the Brain has answered (it has a 4.5 s deadline). */
export async function stopAllAgentWorkFromMain(): Promise<void> {
  await controls?.stopAll().catch(() => undefined);
}

export function clearAgentStopFromMain(): void {
  // Clear only a latched STOP: clearing also resumes dispatch, which a user pause must keep.
  if (controls?.isLatched()) controls.clearStop();
}

const platform: PlatformContext = {
  os: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux',
};

function stopAccelerator(): string | undefined {
  const chord = brainStopAllCommand.keybinding
    ? resolveEffectiveChord(brainStopAllCommand.keybinding, {}, platform)
    : null;
  return chord ? toElectronAccelerator(chord) : undefined;
}

/** "Stop All Agent Work" and "Clear STOP", for the app menu and the tray. */
export function agentStopMenuItems(
  options: { accelerator?: boolean } = {}
): MenuItemConstructorOptions[] {
  const latched = controls?.isLatched() ?? false;
  return [
    {
      id: 'ninebrains-stop-all',
      label: 'Stop All Agent Work',
      ...(options.accelerator ? { accelerator: stopAccelerator() } : {}),
      enabled: controls !== null,
      click: () => void stopAllAgentWorkFromMain(),
    },
    {
      id: 'ninebrains-clear-stop',
      label: latched ? 'Clear STOP (agent work is stopped)' : 'Clear STOP',
      enabled: latched,
      click: () => clearAgentStopFromMain(),
    },
  ];
}

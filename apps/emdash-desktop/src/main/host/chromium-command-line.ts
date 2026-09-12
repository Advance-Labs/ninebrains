import { LIBSECRET_PASSWORD_STORE, shouldForceLibsecretBackend } from './linux-secret-storage';

type ChromiumCommandLine = {
  appendSwitch(name: string, value?: string): void;
  hasSwitch(name: string): boolean;
};

type ConfigureChromiumCommandLineOptions = {
  commandLine: ChromiumCommandLine;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

/** Apply Chromium switches that must be set before Electron emits `ready`. */
export function configureChromiumCommandLine({
  commandLine,
  env = process.env,
  platform = process.platform,
}: ConfigureChromiumCommandLineOptions): void {
  // Ninebrains e2e only: a mock keychain, so safeStorage never touches (or prompts for)
  // the real login keychain on each unsigned rebuild. Never set in normal runs.
  if (env.NINEBRAINS_E2E === '1') commandLine.appendSwitch('use-mock-keychain');
  if (platform !== 'linux') return;

  commandLine.appendSwitch('ozone-platform-hint', 'auto');
  if (
    shouldForceLibsecretBackend(env, {
      passwordStoreSwitchPresent: commandLine.hasSwitch('password-store'),
    })
  ) {
    commandLine.appendSwitch('password-store', LIBSECRET_PASSWORD_STORE);
  }
}

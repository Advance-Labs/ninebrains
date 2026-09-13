import { describe, expect, it, vi } from 'vitest';
import { configureChromiumCommandLine } from './chromium-command-line';

const commandLine = () => ({ appendSwitch: vi.fn(), hasSwitch: vi.fn(() => false) });

describe('e2e mock keychain', () => {
  it('appends use-mock-keychain only when NINEBRAINS_E2E=1', () => {
    const e2e = commandLine();
    configureChromiumCommandLine({
      commandLine: e2e,
      env: { NINEBRAINS_E2E: '1' },
      platform: 'darwin',
    });
    expect(e2e.appendSwitch).toHaveBeenCalledWith('use-mock-keychain');

    for (const env of [{}, { NINEBRAINS_E2E: 'true' }, { NINEBRAINS_E2E: '0' }]) {
      const normal = commandLine();
      configureChromiumCommandLine({ commandLine: normal, env, platform: 'darwin' });
      expect(normal.appendSwitch).not.toHaveBeenCalled();
    }
  });
});

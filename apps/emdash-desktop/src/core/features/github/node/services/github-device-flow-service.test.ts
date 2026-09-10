import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_OAUTH_APP_REQUIRED_MESSAGE,
  readGitHubOAuthClientId,
} from '@core/primitives/app-identity/api/github-oauth-app';
import { GitHubDeviceFlowService } from './github-device-flow-service';

// Ninebrains ships no GitHub OAuth App client ID until Lucas registers one (docs/FORK.md).
describe('GitHub device flow without a Ninebrains OAuth App', () => {
  // The ID is a build-time constant (electron.vite.config.ts `define`); an unset
  // NINEBRAINS_GITHUB_OAUTH_CLIENT_ID must yield an empty ID, never a fallback credential.
  it('ships an empty client ID when NINEBRAINS_GITHUB_OAUTH_CLIENT_ID is not set', () => {
    expect(readGitHubOAuthClientId()).toBe('');
  });

  it('refuses to start with an empty client ID and never contacts GitHub', async () => {
    const createDeviceAuth = vi.fn();
    const upsertAccount = vi.fn();
    const service = new GitHubDeviceFlowService({
      accountStore: { upsertAccount },
      identityClient: { getAuthenticatedUser: vi.fn() },
      publishEvent: vi.fn(),
      createDeviceAuth,
      config: { clientId: '', scopes: ['repo'] },
    });

    await expect(service.start()).resolves.toEqual({
      success: false,
      error: GITHUB_OAUTH_APP_REQUIRED_MESSAGE,
    });
    expect(createDeviceAuth).not.toHaveBeenCalled();
    expect(upsertAccount).not.toHaveBeenCalled();
  });
});

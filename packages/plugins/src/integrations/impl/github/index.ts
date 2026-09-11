import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { verifyGitHubCredentials } from './client';
import { icon } from './icon';

const plugin = defineIntegrationPlugin(
  {
    id: 'github',
    name: 'GitHub',
    description: 'Work on GitHub issues and PRs',
    websiteUrl: 'https://github.com',
  },
  {
    auth: {
      methods: [
        { kind: 'oauth', providerId: 'github' },
        {
          kind: 'oauth-device',
          // Ninebrains: Emdash's OAuth App client ID is removed. The desktop app supplies its own
          // from NINEBRAINS_GITHUB_OAUTH_CLIENT_ID at build time; empty disables device flow.
          clientId: '',
          scopes: ['repo', 'read:user', 'read:org'],
        },
        { kind: 'cli-import', cli: 'gh' },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials): Promise<VerifyResult> {
      const result = await verifyGitHubCredentials(credentials);
      if (!result.success) {
        return {
          connected: false,
          error: result.error.message,
        };
      }

      return {
        connected: true,
        ...result.data,
      };
    },
  },
});

type ImportMetaWithEnv = ImportMeta & { env: { NINEBRAINS_GITHUB_OAUTH_CLIENT_ID?: string } };

/**
 * Ninebrains: the GitHub OAuth App client ID for device-flow sign-in. Emdash's client ID was
 * removed (it is another company's credential, and GitHub's consent page would say "Emdash").
 * The value comes from NINEBRAINS_GITHUB_OAUTH_CLIENT_ID at build time (the `define` in
 * electron.vite.config.ts bakes it into the main and renderer bundles) and is empty by default,
 * which turns device flow off. See docs/FORK.md for registering the OAuth App.
 *
 * Read at call time rather than module load so tests can stub the env.
 */
export function readGitHubOAuthClientId(): string {
  return ((import.meta as ImportMetaWithEnv).env.NINEBRAINS_GITHUB_OAUTH_CLIENT_ID ?? '').trim();
}

export const GITHUB_OAUTH_APP_REQUIRED_MESSAGE =
  'GitHub sign-in with a one-time code needs a Ninebrains OAuth App (see docs/FORK.md). ' +
  'Import an account from the GitHub CLI instead.';

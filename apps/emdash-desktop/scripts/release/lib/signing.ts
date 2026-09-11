// Ninebrains: code signing is off until we pay for it (plan task 7.1). Every value here comes from
// the environment, so a build with no signing env packages unsigned and never fails; setting the
// env later switches signing on without a config change. See docs/RELEASING.md.
//
// Type-only imports keep this file loadable by `node --test` without node_modules.
import type { MacConfiguration, WindowsConfiguration } from 'electron-builder';

type Env = Record<string, string | undefined>;

export type MacSigning = Pick<MacConfiguration, 'identity' | 'hardenedRuntime' | 'notarize'>;
export type WinSigning = Pick<WindowsConfiguration, 'azureSignOptions'>;

const APPLE_ID_VARS = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] as const;
const APPLE_API_KEY_VARS = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'] as const;
// Microsoft Entra ID credentials that electron-builder's Azure signer reads from the env.
const AZURE_AUTH_VARS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] as const;
// Our own names for the Artifact Signing (formerly Trusted Signing) account and profile.
const AZURE_PROFILE_VARS = [
  'NINEBRAINS_AZURE_SIGNING_ENDPOINT',
  'NINEBRAINS_AZURE_SIGNING_ACCOUNT',
  'NINEBRAINS_AZURE_CERT_PROFILE',
  'NINEBRAINS_AZURE_PUBLISHER',
] as const;

function present(env: Env, name: string): boolean {
  return (env[name] ?? '').trim() !== '';
}

// All-or-nothing: a partial set means someone meant to sign and made a mistake, which must fail
// loudly instead of shipping an unsigned build that was supposed to be signed.
function completeSet(env: Env, names: readonly string[], label: string): boolean {
  const set = names.filter((name) => present(env, name));
  if (set.length === 0) return false;
  if (set.length < names.length) {
    const missing = names.filter((name) => !present(env, name));
    throw new Error(`${label} is partly configured; missing: ${missing.join(', ')}`);
  }
  return true;
}

export function hasMacIdentity(env: Env): boolean {
  return present(env, 'CSC_LINK') || present(env, 'CSC_NAME');
}

/**
 * No certificate: ad-hoc sign (`identity: '-'`). Apple Silicon refuses to run unsigned arm64 code,
 * and an explicit identity stops electron-builder picking up whatever certificate happens to be in
 * the local keychain. Hardened runtime stays on; ad-hoc works with it because
 * build/entitlements.mac.plist grants `disable-library-validation`.
 *
 * Certificate via CSC_LINK / CSC_NAME: electron-builder signs with it, and notarizes when a
 * complete Apple ID or App Store Connect API key set is also present.
 */
export function resolveMacSigning(env: Env): MacSigning {
  const appleId = completeSet(env, APPLE_ID_VARS, 'Apple ID notarization');
  const apiKey = completeSet(env, APPLE_API_KEY_VARS, 'Apple API key notarization');
  if (!hasMacIdentity(env)) {
    if (appleId || apiKey) {
      throw new Error('Notarization credentials are set but no CSC_LINK / CSC_NAME certificate');
    }
    return { identity: '-', hardenedRuntime: true, notarize: false };
  }
  return { identity: undefined, hardenedRuntime: true, notarize: appleId || apiKey };
}

/**
 * Windows signs through Azure Artifact Signing when both the Entra credentials and our profile
 * vars are complete. A PFX in CSC_LINK / WIN_CSC_LINK is picked up by electron-builder itself.
 * Neither set: unsigned.
 */
export function resolveWinSigning(env: Env): WinSigning {
  const auth = completeSet(env, AZURE_AUTH_VARS, 'Azure signing credentials');
  const profile = completeSet(env, AZURE_PROFILE_VARS, 'Azure signing profile');
  if (auth !== profile) {
    throw new Error('Azure signing needs both the AZURE_* credentials and the NINEBRAINS_AZURE_* profile');
  }
  if (!auth) return { azureSignOptions: undefined };
  return {
    azureSignOptions: {
      publisherName: env.NINEBRAINS_AZURE_PUBLISHER!,
      endpoint: env.NINEBRAINS_AZURE_SIGNING_ENDPOINT!,
      codeSigningAccountName: env.NINEBRAINS_AZURE_SIGNING_ACCOUNT!,
      certificateProfileName: env.NINEBRAINS_AZURE_CERT_PROFILE!,
    },
  };
}

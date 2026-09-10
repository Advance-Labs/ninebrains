// Inlined rather than re-exported from ./app-identity so this module has no relative
// imports. It is loaded under Node (--experimental-strip-types) by
// electron-builder.canary.config.ts, where extensionless ESM specifiers do not resolve.
// Keep in sync with R2_BASE_URL and COPYRIGHT in ./app-identity.ts.
export const R2_BASE_URL = 'https://github.com/Advance-Labs/ninebrains/releases/latest/download';
export const COPYRIGHT =
  'Copyright © 2026 Advance Labs Inc. Portions © General Action, Inc. (Emdash, Apache-2.0).';

export const APP_ID = 'dev.advancelabs.ninebrains.canary';
export const PRODUCT_NAME = 'Ninebrains Canary';
export const APP_NAME_LOWER = 'ninebrains-canary';
export const UPDATE_CHANNEL = 'v1-canary';
export const ARTIFACT_PREFIX = 'ninebrains-canary';

type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'dev.advancelabs.ninebrains.canary' : 'dev.advancelabs.ninebrains';
export const PRODUCT_NAME = isCanary ? 'Ninebrains Canary' : 'Ninebrains';
export const APP_NAME_LOWER = isCanary ? 'ninebrains-canary' : 'ninebrains';
export const USER_DATA_DIR_NAME = isDev
  ? 'ninebrains-dev'
  : isCanary
    ? 'ninebrains-canary'
    : 'ninebrains';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'ninebrains-canary' : 'ninebrains';
// Ninebrains publishes to GitHub Releases only; Emdash's R2 bucket (releases.emdash.sh) is unused.
export const R2_BASE_URL = 'https://github.com/Advance-Labs/ninebrains/releases/latest/download';
export const IS_CANARY = isCanary;
export const COPYRIGHT =
  'Copyright © 2026 Advance Labs Inc. Portions © General Action, Inc. (Emdash, Apache-2.0).';

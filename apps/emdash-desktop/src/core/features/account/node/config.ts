export const ACCOUNT_CONFIG = {
  authServer: {
    // Ninebrains: Emdash's hosted account server (auth.emdash.sh) is cut and every account entry
    // point is hidden behind HOSTED_ACCOUNT_ENABLED. An empty base URL makes any stray call fail
    // locally instead of reaching Emdash.
    baseUrl: '',
    authTimeoutMs: Number(process.env.EMDASH_AUTH_TIMEOUT_MS || 300000),
  },
};

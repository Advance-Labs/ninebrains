/**
 * Ninebrains' own update signing identity (no paid CA).
 *
 * The self-hosted updater trusts nothing on the network until a release's `SHA256SUMS.json` has
 * been verified against THIS public key, so the bytes it installs are the bytes Advance Labs
 * signed. The matching private key lives only in the GitHub repository secret
 * `NINEBRAINS_UPDATE_SIGNING_KEY` (and a password-manager backup); the release workflow signs
 * every release's checksums with it (scripts/release/sign-update-digest.mjs).
 *
 * Rotation: generate a new keypair, replace this constant and ship it, then update the secret.
 * Old public keys are deliberately not kept here: an installer must verify against the key the
 * RUNNING build was shipped with, so an upgrade chain is only as strong as its oldest link.
 * See docs/SIGNING.md, "Our own update signature".
 */
export const UPDATE_SIGNING_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAXPkhbiRI1mUAK5Tz6umhyfa4X3Y8AvuAeGdTT3vwVn0=\n' +
  '-----END PUBLIC KEY-----\n';

# Signing rollout

The plan for getting Ninebrains signed by Apple (and later Microsoft), and what we do until then.
The mechanics of each switch live in [RELEASING.md](RELEASING.md#turning-signing-on-later). This
page is the order of operations, the costs, and what changes for users.

## Where we are

| Path | macOS today |
|---|---|
| One-line installer (`curl … /install \| sh`) | No warning. The app is never quarantined, because `curl` is not a quarantine-aware downloader. The installer checks SHA256SUMS, bundle id, version and `codesign --verify` itself. |
| `.dmg` from a browser | "Apple cannot check it for malicious software". Users go through Privacy & Security → Open Anyway. |
| Every update, either path | Keychain prompt for "Ninebrains Safe Storage". An ad-hoc signature has no stable identity, so each build counts as a new app. |

**Until signing lands, point macOS users at the installer.** The site's default tab, the release
notes and the docs now say so, and explain why it doesn't warn. The installer does not strip
quarantine and never will (`install.test.mjs` fails on any `xattr`). Removing the flag from
something a browser downloaded would switch off a user's protection. Not creating it in the first
place is different: that's how every `curl | sh` installer behaves, Homebrew included.

## Phase 1: Apple Developer ID + notarization

Cost: USD 99 a year (Apple Developer Program). Everything else is free.
Lead time: mostly waiting on Apple, typically a few days to two weeks.

1. **Get a D-U-N-S number for Advance Labs Inc.** Apple requires one to enroll as an organization.
   It's free through Apple's D-U-N-S lookup on developer.apple.com. Use the exact legal name from the
   federal incorporation. Dun & Bradstreet can take several business days.
2. **Enroll in the Apple Developer Program as an organization** from an Apple ID on
   `lucas@advancelabs.dev`. Apple checks that you can sign for the company, sometimes by phone, and
   that `advancelabs.dev` is the company's site.
   - *Why not enroll as an individual?* It's faster, but the certificate would read "Lucas
     Krawczak" instead of "Advance Labs Inc.". Moving to the organization later changes the Team ID,
     so every user gets one more Keychain prompt and a new identity to trust. Enroll once, as the
     company.
3. **Create a Developer ID Application certificate.** Only the Account Holder can. Xcode → Settings
   → Accounts → Manage Certificates → + → *Developer ID Application*. Or make a CSR in Keychain
   Access and upload it at developer.apple.com → Certificates. Export it from Keychain Access as a
   `.p12` with a strong password. Keep the `.p12` and password in the password manager. A Developer
   ID certificate lasts five years, and losing it means reissuing.
4. **Create an App Store Connect API key for notarization.** App Store Connect → Users and Access →
   Integrations → App Store Connect API → Team Keys → generate one with the *Developer* role.
   Download the `.p8` (Apple only lets you do this once) and note the Key ID and Issuer ID.
5. **Add the repository secrets:**
   ```sh
   base64 -i DeveloperID.p12 | gh secret set CSC_LINK --repo Advance-Labs/ninebrains
   gh secret set CSC_KEY_PASSWORD  --repo Advance-Labs/ninebrains   # prompts for the value
   gh secret set APPLE_TEAM_ID     --repo Advance-Labs/ninebrains
   gh secret set APPLE_API_KEY_P8  --repo Advance-Labs/ninebrains < AuthKey_XXXXXXXXXX.p8
   gh secret set APPLE_API_KEY_ID  --repo Advance-Labs/ninebrains
   gh secret set APPLE_API_ISSUER  --repo Advance-Labs/ninebrains
   ```
   Then delete the local `.p12` and `.p8` copies that aren't in the password manager. No code change
   is needed. `signing.ts` switches to the real identity and turns notarization on, and the release
   workflow's verify step then *requires* Developer ID, the right team, a stapled ticket and
   `spctl` reporting `source=Notarized Developer ID`. A partial set fails the build instead of
   shipping something that still warns.
6. **Cut a canary first.** `gh workflow run release.yml --ref main -f version=<x.y.z-canary.N> -f
   channel=canary`. Notarization adds a few minutes per arch. On a Mac that has never run Ninebrains,
   download the canary `.dmg` in Safari and open it. It should open with only the standard
   "downloaded from the internet" confirmation.
7. **Then the stable release, plus the copy cleanup that goes with it:**
   - The notes' opening line in `release.yml` ("**Unsigned build.** macOS will say…") is hard-coded.
     Reword it for signed macOS, and keep the Windows warning while Windows is still unsigned.
   - Remove or shorten the macOS unsigned sections in `.github/release-notes/install.md`,
     `docs/guide/verify-download.md`, `docs/RELEASING.md` and the site's "Unsigned build" panel.
   - Warn users once: the first launch of the first signed build asks for the Keychain one last
     time, because the identity changed from ad-hoc to Developer ID. After that it sticks across
     updates.
8. **Re-examine the update path** ([RELEASING.md, "In-app updates"](RELEASING.md#in-app-updates)).
   The updater already runs on Ninebrains' own Ed25519 signature and does not wait for OS signing;
   with a Developer ID identity the extra wins are: macOS Keychain ("Safe Storage") stops re-prompting
   on every update, and Gatekeeper accepts each new build without "Open Anyway". The update trust
   chain itself is unchanged.

The installer needs no change for Phase 1. It already reports the signing authority when the
signature isn't ad-hoc, and the Terminal path stays the one-command way to install and update.

## Phase 2: Windows

Windows users see SmartScreen's "Windows protected your PC". Options, cheapest first:

- **Azure Artifact Signing** (formerly Trusted Signing), about USD 10 a month. Already wired
  (`resolveWinSigning`). Microsoft validates the organization before issuing a public-trust profile
  and has required a verifiable business history. Check whether a newly incorporated Canadian
  company qualifies *before* paying.
- **An OV certificate from a CA**, roughly USD 200–400 a year. New certificates must live on a
  hardware token or a cloud HSM, so CI signs through the CA's cloud signing service rather than a
  `.pfx` file. Budget the extra setup time.

Signing alone doesn't clear SmartScreen immediately: reputation builds with downloads. Expect the
warning to fade over the first releases rather than vanish on day one.

## Our own update signature (already live)

The app updates itself with a signature we issue, independent of Apple or Microsoft:

- The release signs its `SHA256SUMS.json` with an Ed25519 key whose private half is the repo secret
  `NINEBRAINS_UPDATE_SIGNING_KEY`; the app embeds the public half
  (`src/core/primitives/app-identity/api/update-signing-key.ts`). Every update must verify against
  that key before it is even offered, and applies only after the user chooses **Restart now**. See
  [RELEASING.md, "In-app updates"](RELEASING.md#in-app-updates) and `agents/risky-areas/updater.md`.
- **This is not an OS code signature.** It does nothing for Gatekeeper, SmartScreen, or the macOS
  Safe Storage re-prompts; those still wait for Phase 1/2 above. It is the *update* trust anchor,
  and it is what makes the updater safe on unsigned builds.
- **Key handling.** The `.pem` lives in the password manager, never in the repo. Rotate by
  (a) generating a new key, (b) embedding the new public half and shipping it in the same release
  that first uses the new private half — the embedded key is only read at update time, so at least
  one release must trust both during the switch — and (c) re-pointing the secret. Keep the old
  public half trusted until the last build that embeds it is out of support. A rotated secret is
  what the release job uses the same day (`sign-update-digest.mjs` fails closed if it is unset).

## Not doing

- **Stripping quarantine in the installer or the app.** See above.
- **Switching the update signature to a CA-issued certificate.** The Ed25519 key is ours to issue
  and to rotate, and the checksum file it signs carries no third-party cost or expiry. It already
  satisfies SEC-36; OS signing is a separate layer above it.

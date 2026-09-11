# Releasing Ninebrains

Ninebrains ships **unsigned**. macOS builds are ad-hoc signed and not notarized, and Windows builds
carry no Authenticode signature. The integrity guarantee comes from the `SHA256SUMS` published with
every release (THREAT-MODEL SEC-37). Auto-update stays off until signing lands (SEC-36).

- Workflow: `.github/workflows/release.yml` (manual only)
- Builder configs: `apps/emdash-desktop/electron-builder.config.ts` (stable), `electron-builder.canary.config.ts`
- Signing switch: `apps/emdash-desktop/scripts/release/lib/signing.ts`
- Checksums: `apps/emdash-desktop/scripts/release/checksums.mjs`
- Tests: `node --test apps/emdash-desktop/scripts/release/*.test.mjs` (no install needed)

## Targets

| OS | Target | Arch | File |
|---|---|---|---|
| macOS | dmg, zip | arm64, x64 (two builds, not universal) | `Ninebrains-0.1.0-mac-arm64.dmg`, `…-mac-x64.zip` |
| Windows | NSIS installer | x64 | `Ninebrains-0.1.0-win-x64.exe` |
| Linux | AppImage, deb | x64 | `Ninebrains-0.1.0-linux-x86_64.AppImage`, `…-linux-amd64.deb` |

The name pattern is `Ninebrains-${version}-${os}-${arch}.${ext}`. electron-builder writes the Linux
arch in each format's own naming (`x86_64` for AppImage, `amd64` for deb).

Dropped from upstream: **rpm** and **msi** (not in the v0.1 scope, and each one is a separate
installer to support) and **Windows arm64**. Windows arm64 would mean cross-compiling `node-pty` and
`better-sqlite3` for ARM64 on an x64 runner with the ARM64 MSVC toolchain. That is not cheap to prove,
and we have no arm64 Windows machine to test on. Add it back once someone asks for it.

## Cutting a release

Only Lucas publishes. Nothing is public until the draft is published.

1. **Bump the version** in `apps/emdash-desktop/package.json` and merge that to `main`. The workflow
   refuses a version input that doesn't match the file.
2. **Dispatch the workflow** from `main`:
   ```sh
   gh workflow run release.yml --repo Advance-Labs/ninebrains --ref main -f version=0.1.0
   ```
   Or use **Actions → Release → Run workflow** in the GitHub UI. Expect about 30–60 runner-minutes. The
   macOS job is the long one because it packages two arches, and macOS minutes bill at 10×.
3. **Review the draft** at **Releases**. Look for:
   - five installers, plus `SHA256SUMS` and `SHA256SUMS.json`;
   - notes that include the sums and the unsigned warning;
   - the run summary line "Draft v0.1.0 is ready for review", which appears only after the draft
     was re-downloaded and re-verified;
   - a check on at least one real machine: download the installer, verify it (below), install it and
     launch it.
4. **Publish** the draft. Publishing creates the `v0.1.0` tag at the commit the draft targets (the
   commit the workflow built).

### What the workflow does

| Job | Runs on | Permissions | Does |
|---|---|---|---|
| `preflight` | ubuntu-latest | `contents: read` | Checks the version input against `package.json`; runs the SEC-36/SEC-37 node tests |
| `build` ×3 | macos-14, windows-2022, ubuntu-22.04 | `contents: read` | `pnpm run build`, then `build.ts` in local mode; `verify-mac.ts` on macOS; uploads installers as workflow artifacts |
| `attest` | ubuntu-latest | `id-token`, `attestations: write` | Build-provenance attestations. Skipped while the repo is private (see below) |
| `release` | ubuntu-latest | `contents: write` | Writes and verifies `SHA256SUMS`, creates or reuses the draft, uploads with `--clobber`, deletes stale assets, then re-downloads the draft and re-verifies |

Only the `release` job can write to the repo, and it runs no project code beyond `checksums.mjs`. The
build jobs, which install and run third-party packages, have read-only tokens. The runner images match
`build-matrix.yml`: `setup-build` pins MSVC 2022, and ubuntu-22.04 keeps the glibc floor at 2.35.

**Idempotent.** Re-running a failed run, or dispatching the same version again from the same commit,
rebuilds everything and reuses the one draft for the tag. The workflow stops without changing
anything if:
- `vX.Y.Z` is already **published** (bump the version instead);
- the existing draft targets a **different commit** (delete that draft, or dispatch from its commit);
- more than one draft exists for the tag.

A draft release does not create a git tag, so a stale draft is safe to delete from the Releases page.

### Building locally

```sh
cd apps/emdash-desktop
pnpm -w run build
node --experimental-strip-types scripts/release/build.ts --platform mac --arch arm64 --targets dmg
node scripts/release/checksums.mjs release
```

Without `--release-id`, `build.ts` never contacts GitHub. Output lands in `apps/emdash-desktop/release/`,
which is gitignored. It takes several GB, so delete it when you're done.

## Verifying a download (for users)

Download `SHA256SUMS` from the same release page into the folder that holds the installer.

**macOS**

```sh
cd ~/Downloads
shasum -a 256 -c SHA256SUMS --ignore-missing
# Ninebrains-0.1.0-mac-arm64.dmg: OK
```

**Linux**

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

**Windows (PowerShell)**

```powershell
$expected = (Select-String -Path .\SHA256SUMS -Pattern 'Ninebrains-0.1.0-win-x64.exe').Line.Split(' ')[0]
$actual = (Get-FileHash .\Ninebrains-0.1.0-win-x64.exe -Algorithm SHA256).Hash.ToLower()
if ($actual -eq $expected) { 'OK' } else { 'MISMATCH - do not run this file' }
```

Anything other than `OK` means the file is not the one we built. Delete it.

**What this proves.** A matching hash means you have the exact bytes CI uploaded, not a corrupted or
swapped download. It does **not** prove who built them: the sums live on the same GitHub release, so
someone who controls the release could change both. Signing and provenance attestations close that gap.
Once attestations are on:

```sh
gh attestation verify Ninebrains-0.1.0-mac-arm64.dmg --repo Advance-Labs/ninebrains
```

## Opening an unsigned build

**Read this first.** Apple and Microsoft show these warnings because nobody has vouched for the app's
publisher. The steps below switch that protection off for Ninebrains. Only do it after the checksum
above matches, and only for a file you downloaded from `github.com/Advance-Labs/ninebrains/releases`.

### macOS Gatekeeper

The first launch says the app "can't be opened because Apple cannot check it for malicious software".

- **macOS 14 and earlier:** in Finder, right-click (or Control-click) `Ninebrains.app` → **Open** →
  **Open**. You only need to do this once.
- **macOS 15 (Sequoia) and later:** right-click → Open no longer offers a bypass. Try to open the app
  once, then go to **System Settings → Privacy & Security**, scroll to *"Ninebrains" was blocked*, click
  **Open Anyway** and confirm with your password.
- **Terminal** (any version): remove the quarantine flag from the installed app.
  ```sh
  xattr -dr com.apple.quarantine /Applications/Ninebrains.app
  ```

The honest trade-off: an unnotarized app has not been scanned by Apple. Removing the quarantine flag
also skips the one-time check macOS runs on first launch. Your protection is the checksum, plus your
trust in this repository.

### macOS Keychain prompt on every new build

On first launch, macOS may ask: *"Ninebrains wants to use your confidential information stored in
'Ninebrains Safe Storage' in your keychain"*. Click **Always Allow**. The app encrypts its cookie
store and saved secrets with that key, and **it cannot start until you answer**. No window appears
while the prompt is open.

An ad-hoc signature has no stable identity: every build has a new code hash, so the Keychain treats
each update as a different app and asks again. The same happens if another build of the app (a dev
or e2e run) created the key first. Clicking **Deny** leaves the app unable to read the key. A
Developer ID signature (below) makes the approval stick across updates.

### Windows SmartScreen

The installer shows "Windows protected your PC". Click **More info** → **Run anyway**. SmartScreen warns
about any installer without a signature and a download reputation. Signing (below) is what removes the
warning. Some managed or corporate machines hide **Run anyway** completely, and you can't get past that
without an administrator.

### Linux

No gate. `chmod +x Ninebrains-*.AppImage && ./Ninebrains-*.AppImage`, or
`sudo apt install ./Ninebrains-*-linux-amd64.deb`.

## Turning signing on later

No code change is needed. `scripts/release/lib/signing.ts` reads everything from the environment, and
the workflow already passes the variables through (empty today). With nothing set, the build packages
unsigned and never fails. A **partial** set fails the build on purpose, so a release that was meant to
be signed can't ship unsigned by accident.

### macOS: Apple Developer ID (USD 99/yr) + notarization

1. Join the Apple Developer Program as the organization Advance Labs Inc. This needs a D-U-N-S number,
   and verification can take days.
2. Create a **Developer ID Application** certificate and export it as a `.p12`.
3. Add repository **secrets**:
   - `CSC_LINK`: the base64-encoded `.p12`.
   - `CSC_KEY_PASSWORD`: the password for the `.p12`.
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) and `APPLE_TEAM_ID`.

   `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` (an App Store Connect API key) also
   work, but would need adding to the workflow's Package step env.
4. With `CSC_LINK` set, electron-builder signs with the real identity instead of `-`, keeps hardened
   runtime on, and notarizes through `notarytool` once a complete Apple credential set is present.
   Add `--expected-team-id <TEAMID>` to the workflow's `verify-mac.ts` step so CI checks the
   identity actually used.

### Windows: Azure Artifact Signing (about USD 10/mo)

Azure Artifact Signing was previously called Trusted Signing. Microsoft validates the organization's
identity before it issues a public-trust certificate profile, so check eligibility first.

1. Create an Artifact Signing account and a public-trust certificate profile, plus an Entra app
   registration with the *Artifact Signing Certificate Profile Signer* role on that profile.
2. Add repository **secrets** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`, and
   repository **variables** `NINEBRAINS_AZURE_SIGNING_ENDPOINT` (e.g.
   `https://eus.codesigning.azure.net/`), `NINEBRAINS_AZURE_SIGNING_ACCOUNT`,
   `NINEBRAINS_AZURE_CERT_PROFILE` and `NINEBRAINS_AZURE_PUBLISHER` (the exact subject name on the
   certificate, e.g. `Advance Labs Inc.`).
3. Add a workflow step that runs `scripts/release/verify-win.ts` on Windows. It fails unless every
   installer's Authenticode status is `Valid`. It still filters files on the old `ninebrains-`
   artifact prefix, so update that filter to `Ninebrains-` in the same change.

A `.pfx` from any other CA also works: set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (electron-builder
reads them directly) and pass them in the Package step.

## Why auto-update stays off

Three layers keep it off:
- `UPDATES_ENABLED` is `false` in `src/core/primitives/app-identity/api/fork-flags.ts`;
- `autoInstallOnAppQuit` is `false`;
- the builder configs have `publish: null`, so no `app-update.yml` is packaged into the app and no
  `latest*.yml` feed is produced.

`release-config.test.mjs` fails if a publish provider comes back, or if anything points at upstream's
`generalaction` feed.

The reasons:
- **An update is remote code execution by design.** Without a signature check, whoever can write to
  the feed (a hijacked release, a stolen token, a man-in-the-middle on a misconfigured feed) can
  install code on every user's machine (THREAT-MODEL T28).
- **The platform checks need signatures.** electron-updater on macOS (Squirrel.Mac) only installs an
  update signed by the same identity as the running app. On Windows, the publisher check that
  electron-updater runs has nothing to compare against when the app is unsigned.
- **The feed is unreachable anyway.** The repo is private, so the GitHub provider cannot read it
  without a token.

Turning it on is one change that happens after signing:
1. Restore a `github` provider for `Advance-Labs/ninebrains` in both builder configs.
2. Set `UPDATES_ENABLED` to `true`.
3. Update the SEC-36 test to allow exactly that provider.
4. Check electron-updater's signature verification on both OSes before the first update ships.

## Versioning

The desktop app starts at **0.1.0** (upstream Emdash was 1.2.4). Before changing it we checked that
nothing keys state or migrations off the version number:

- **DB migrations** are drizzle's, keyed by the migration journal and file hashes (`drizzle/meta/_journal.json`), not the app version.
- **userData** is `ninebrains` (`USER_DATA_DIR_NAME`), with no version in the path.
- **Remote workspace-server** installs resolve the version from the server channel pointer and the
  protocol major (`workspace-server/provision/installer.ts`), independent of the desktop version.
- **`app.getVersion()`** is only displayed (About menu, recovery window), sent as handshake or
  telemetry metadata (telemetry is off), or used by the updater (off).
  `resolveAppVersion`'s `package.json` fallback only matches a package named `emdash`, which is dead
  code in both upstream and here.
- **Canary** versions are derived: `0.1.0` becomes `0.1.1-canary.<run>` (`scripts/release/lib/version.ts`).
- **Downgrade from 1.2.4.** electron-updater rejects downgrades, but no user has a build from our feed,
  and the updater is off.

## Local verification (2026-09-10, macOS 26 arm64)

Command: `build.ts --platform mac --arch arm64 --targets dmg` (local mode, no signing env).

| Check | Result |
|---|---|
| Artifact | `Ninebrains-0.1.0-mac-arm64.dmg`, 227,193,328 bytes (216.7 MiB); the unpacked `.app` is 764 MB |
| Bundle | `CFBundleIdentifier` `dev.advancelabs.ninebrains`, name and executable `Ninebrains`, version `0.1.0` |
| Icon | `icon.icns` is byte-identical to `src/assets/images/emdash/emdash.icns`, the asset the fork ships today |
| Signature | `Signature=adhoc`, `flags=(adhoc,runtime)`; `codesign --verify --deep --strict` passes on the app inside the dmg; notarization skipped |
| SEC-36 | no `Contents/Resources/app-update.yml`; builder reported "Prepared 0 local update manifest(s)" |
| Launch | Starts from the mounted dmg and takes its singleton lock in `~/Library/Application Support/ninebrains`; no `emdash` directory is created. Boot then waits on the Keychain prompt above (the key was created earlier by an e2e run with a different signature). With `--use-mock-keychain` it boots fully (20 processes, services running). |
| Checksums | `checksums.mjs release` wrote `SHA256SUMS` and `SHA256SUMS.json`; `--verify` and `shasum -a 256 -c SHA256SUMS` both pass |

Found and fixed: `build.ts` copied `release/` out of the deploy dir with `cpSync` but without
`verbatimSymlinks`. Node rewrote the `.framework` symlinks to absolute paths into the deploy dir,
which is deleted afterwards, so the copied `release/mac-*/Ninebrains.app` failed
`codesign --verify`, and `verify-mac.ts` in CI would have failed with it. The dmg and zip were not
affected. After the fix, a re-package (`--targets dir`) passes both `codesign --verify --deep
--strict` and `verify-mac.ts`.

Not verified locally: the x64 mac, Windows and Linux builds (they need their runners), and the
workflow itself (it has never been dispatched).

## Threat-model coverage

| Requirement | Status |
|---|---|
| SEC-36: no `app-update.yml`, no update timer, `autoInstallOnAppQuit` unreachable, no upstream owner | Met. `publish: null` in both configs; `UPDATES_ENABLED=false` returns before any `autoUpdater` setup; `release-config.test.mjs` rejects a publish provider or `generalaction`. The packaged-app check under Local verification confirms there is no `app-update.yml` in the bundle. |
| SEC-37: `SHA256SUMS` as an asset and in the release notes | Met. |
| SEC-37 test: the workflow re-verifies sums before publishing | Met, twice: before upload, and again after re-downloading the draft. Publishing stays a human step after both. |
| SEC-37: CI builds from a tag | **Deviation.** Dispatch-only, by decision (Actions minutes, and publishing is Lucas's call). The draft is pinned to the built commit, and publishing creates the tag at that commit, so the tag and the bytes still match. |
| SEC-37: provenance attestations | **Partial.** The `attest` job exists but GitHub only offers attestations on public repos or Enterprise Cloud. It turns on automatically when the repo goes public, or with repo variable `NINEBRAINS_ATTEST=true`. |
| SEC-37: README documents `shasum -a 256 -c` and `gh attestation verify` | Documented here. The root README is a placeholder; link it to this section when the README is written. |
| R8 (accepted): unsigned, checksums and attestations only | Unchanged. |

Actions are referenced by version tag (`actions/checkout@v4` and so on), not by SHA, the same as
every other workflow in this repo. Pinning all of them to SHAs is a separate follow-up.

# Releasing Ninebrains

Ninebrains ships **unsigned**. macOS builds are ad-hoc signed and not notarized, and Windows builds
carry no Authenticode signature. Manual downloads are verified with the `SHA256SUMS` published with
every release (THREAT-MODEL SEC-37) plus build-provenance attestations. The in-app updater does not
rely on OS signatures: every update it installs must verify against Ninebrains' own Ed25519 update
key, whose public half is compiled into the app (THREAT-MODEL SEC-36). Updates are user-initiated:
the app offers a **Download** button and a **Restart now** choice, and nothing downloads or applies
on its own (see [In-app updates](#in-app-updates)).

- Workflow: `.github/workflows/release.yml` (manual only, from `main` or `release/*`)
- Gate: `ci-ok` green on the exact commit (`tooling/scripts/require-green.mjs`), plus e2e in the run
- Changelog: `CHANGELOG.md`, written by `pnpm run release:prepare X.Y.Z` (`tooling/scripts/changelog.mjs`)
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

1. **Prepare the release in a PR.** From an up-to-date `main`:
   ```sh
   git switch -c chore/release-0.2.0 origin/main
   pnpm run release:prepare 0.2.0      # bumps apps/emdash-desktop/package.json, writes CHANGELOG.md
   ```
   The new `CHANGELOG.md` section holds any hand-written notes from **Unreleased**, then the
   Conventional Commit titles on `main` since the last `v*` tag, grouped into breaking changes,
   features, fixes, performance, reverts and docs (`chore`, `ci`, `test`, `style`, `refactor` and
   `build` are left out). Edit it into something a user wants to read. Commit with
   `git commit -s -m "chore(release): 0.2.0"`, open the PR, and merge it with `pnpm run merge <pr>`
   once `ci-ok` is green. The merge script waits for CI on the merge commit.
2. **Dispatch the workflow** from `main` once `ci-ok` is green on the merge commit:
   ```sh
   gh workflow run release.yml --repo Advance-Labs/ninebrains --ref main -f version=0.2.0 -f channel=stable
   ```
   Or use **Actions → Release → Run workflow** in the GitHub UI. Expect about 30–60 runner-minutes. The
   macOS job is the long one because it packages two arches, and macOS minutes bill at 10×.
   Preflight stops the run, before any build, when:
   - the ref is not `main` or `release/*`;
   - `ci-ok` is not green on the exact commit being built;
   - the version input differs from `package.json`;
   - `CHANGELOG.md` has no section for the version.
3. **Review the draft** at **Releases**. Look for:
   - seven installers (a `.dmg` and a `.zip` for each Mac arch, the Windows `.exe`, the `.AppImage`
     and the `.deb`), plus `SHA256SUMS` and `SHA256SUMS.json`;
   - notes that open with the unsigned warning, then the install steps and docs links from
     `.github/release-notes/install.md`, then the changelog section and the sums. When the steps in
     [Opening an unsigned build](#opening-an-unsigned-build) change, change that file too;
   - the run summary line "Draft v0.1.0 is ready for review", which appears only after the draft
     was re-downloaded and re-verified;
   - a check on at least one real machine: download the installer, verify it (below), install it and
     launch it.
4. **Publish** the draft. Publishing creates the `v0.2.0` tag at the commit the draft targets (the
   commit the workflow built).

### Canary builds

```sh
gh workflow run release.yml --repo Advance-Labs/ninebrains --ref main -f version=0.2.0 -f channel=canary
```

`version` is still the `package.json` version. The run derives `0.2.1-canary.<run number>` from it
(`scripts/release/lib/version.ts`), packages with `electron-builder.canary.config.ts` and the
`canary` build variant (app name **Ninebrains Canary**, app id `dev.advancelabs.ninebrains.canary`,
its own `ninebrains-canary` data directory), and marks the draft as a **prerelease**. The notes are
the **Unreleased** section plus the commits since the last tag; no `CHANGELOG.md` change is needed.
Any version with a `-` suffix (`0.3.0-rc.1`) is also marked as a prerelease on the stable channel.

### Hotfix branches (`release/0.x`)

Fix a shipped release without shipping everything that has landed on `main` since:

1. Branch from the tag you are fixing and push the branch: `git switch -c release/0.2 v0.2.0 &&
   git push -u origin release/0.2`. CI runs on pushes to `release/**`, e2e included.
2. Open fix PRs against `release/0.2` (`gh pr create --base release/0.2`). They get the same CI and
   merge through `pnpm run merge <pr>`.
3. Prepare the patch release on the branch (`pnpm run release:prepare 0.2.1` in a PR against
   `release/0.2`), then dispatch from it: `gh workflow run release.yml --ref release/0.2 -f
   version=0.2.1 -f channel=stable`.
4. Bring the fix forward: cherry-pick it onto a branch from `main` and merge that PR too.

## Rolling back

There is an in-app updater, but it only acts on what the user confirms. Rolling back means stopping
new downloads of a bad build and shipping a good one. The updater and the one-line installer both
follow **Latest**, so step 1 below stops them offering a bad build. **Never move or reuse a tag**;
the workflow refuses a published version, and a changed tag breaks everyone's checksums.

- **Still a draft:** delete the draft on the Releases page. Drafts create no tag.
- **Published and bad:**
  1. Stop new downloads now. Edit the release, put a "Do not install" warning at the top of the notes
     and mark it as a prerelease, so it is no longer **Latest**: `gh release edit v0.2.0 --prerelease
     --notes-file warning.md`. If the build is dangerous, delete its installer assets too
     (`gh release delete-asset v0.2.0 <file> --yes`); keep the release and tag as the record.
  2. Point **Latest** back at the last good release: `gh release edit v0.1.0 --latest`.
  3. Ship the fix as a new version (`0.2.1`), from `main` or from a `release/0.2` hotfix branch.
  4. If the bad change is on `main`, revert it through a PR (`git revert <sha>` on a branch, then
     `pnpm run merge <pr>`). Do not push to `main`. The pre-push hook refuses it; the only override is
     `NINEBRAINS_MERGE_GUARD=<sha being pushed>`, for when GitHub itself cannot merge.
  5. Say what happened in the next release's notes (the **Unreleased** section of `CHANGELOG.md`).

### What the workflow does

| Job | Runs on | Permissions | Does |
|---|---|---|---|
| `preflight` | ubuntu-latest | `contents: read`, `checks: read` | Refuses refs other than `main`/`release/*` and commits without a green `ci-ok`; checks the version input against `package.json`; resolves the canary version; pulls the notes from `CHANGELOG.md`; runs the SEC-36/SEC-37 node tests |
| `e2e` | ubuntu-22.04 | `contents: read` | `e2e.yml`: the built app under xvfb with the fake agent. The draft is not created unless it passes |
| `build` ×3 | macos-14, windows-2022, ubuntu-22.04 | `contents: read` | `pnpm run build`, then `build.ts` in local mode; `verify-mac.ts` on macOS; uploads installers as workflow artifacts |
| `attest` | ubuntu-latest | `id-token`, `attestations: write` | Build-provenance attestations. Runs because the repo is public; a private repo would skip it (see below) |
| `release` | ubuntu-latest | `contents: write` | Writes and verifies `SHA256SUMS`, signs `SHA256SUMS.json` with the repo's `NINEBRAINS_UPDATE_SIGNING_KEY` secret (`sign-update-digest.mjs`, fails closed if it is not set), creates or reuses the draft, uploads with `--clobber`, deletes stale assets, then re-downloads the draft and re-verifies |

Only the `release` job can write to the repo, and it runs no project code beyond `checksums.mjs` and
`sign-update-digest.mjs`. The build jobs, which install and run third-party packages, have read-only
tokens. The runner images match
`build-matrix.yml`: `setup-build` pins MSVC 2022, and ubuntu-22.04 keeps the glibc floor at 2.35.

**Update signing.** One gate in the whole pipeline produces a signature: the `release` job signs the
release's checksum file, and the app trusts exactly that. Because the signing step fails closed when
the secret is missing, a release is never published unsigned by accident. The signature is an
Ed25519 digest signature; it is not an OS code signature, so it does not affect Gatekeeper or
SmartScreen (see [SIGNING.md](SIGNING.md)).

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

The one-line installer (`apps/site/public/install`) never meets Gatekeeper. macOS only sets
`com.apple.quarantine` on files a quarantine-aware app (a browser, Mail, AirDrop) writes, and
`curl` and `ditto` are not. So the app it installs is never quarantined, and nothing needs
stripping. That is why the installer contains no `xattr` call, and `install.test.mjs` keeps it
that way. It checks SHA256SUMS, bundle id, version and `codesign --verify` instead, plus provenance
when `gh` is signed in. This is the path to point people at until notarization lands.

For a browser-downloaded `.dmg`, the first launch says the app "can't be opened because Apple cannot check it for malicious software".

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
Developer ID signature (plan task 7.1, below) makes the approval stick across updates.

For local launch checks of a packaged build, skip the prompt with Chromium's mock keychain. It
never touches the real key, so nothing pops up on the desktop:

```sh
open -a apps/emdash-desktop/release/mac-arm64/Ninebrains.app --args --use-mock-keychain
# or: apps/emdash-desktop/release/mac-arm64/Ninebrains.app/Contents/MacOS/Ninebrains --use-mock-keychain
```

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
   - `APPLE_TEAM_ID`: the 10-character Team ID. The verify step needs it whenever `CSC_LINK` is set.
   - Notarization, one of:
     - **App Store Connect API key (preferred):** `APPLE_API_KEY_P8` (the text of the
       `AuthKey_XXXX.p8` file), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. The workflow writes the
       key to the runner's temp dir and sets `APPLE_API_KEY` to that path, which is what
       electron-builder expects.
     - **Apple ID:** `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com).
4. With `CSC_LINK` set, electron-builder signs with the real identity instead of `-`, keeps hardened
   runtime on, and notarizes through `notarytool` once a complete Apple credential set is present.
   The verify step then passes `--expected-team-id`, plus `--expect-notarized` when notarization
   credentials exist. That checks `Authority=Developer ID Application`, the team, a stapled ticket
   (`xcrun stapler validate`) and `spctl --assess` reporting `source=Notarized Developer ID`.

The whole rollout, including enrollment, costs and what changes for users, is in
[SIGNING.md](SIGNING.md).

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

## In-app updates

`UPDATES_ENABLED` is `true`. electron-updater was removed; the updater is a small custom pipeline
under `src/main/host/updates/` so the trust check exactly matches what we sign:

- **Trust anchor.** `scripts/release/sign-update-digest.mjs` signs the release's `SHA256SUMS.json`
  with the Ed25519 private key held as repo secret `NINEBRAINS_UPDATE_SIGNING_KEY`; the app embeds
  the matching public key (`src/core/primitives/app-identity/api/update-signing-key.ts`). Nothing is
  downloaded or applied until that checksum file verifies against the embedded key. This is the
  SEC-36 identity check: a hijacked release or feed still cannot install code, because it cannot
  produce a valid signature. The signing step in `release.yml` fails closed — a release without a
  signature is a broken release.
- **Check.** In packaged builds only, 30 s after startup and then hourly, the app asks GitHub
  (`api.github.com`, unauthenticated) for the newest release on its channel: `releases/latest` on
  stable, a scan of `-canary.N` prereleases on canary. Version order is SemVer precedence; a release
  older than or equal to the running version is ignored.
- **Nothing auto-installs.** A verified newer version surfaces a **Download** button on a small
  pill at the bottom-right. The download streams to a staging directory and is re-checked against
  the signed digest byte-for-byte before the update is considered ready; a mismatch discards it and
  reports an error. The user then picks **Restart now**.
- **Apply on relaunch.** The app quits; on the next launch it applies the staged update in place and
  relaunches onto it (macOS and Linux). On Windows the running `.exe` cannot be replaced, so the
  staged NSIS installer is launched from `will-quit` and `runAfterFinish: true` restarts the app.
- **Channels and artifacts.** Stable publishes `Ninebrains-<version>-<os>-<arch>.<ext>`; canary
  publishes `Ninebrains-Canary-<version>-<os>-<arch>.<ext>` as a prerelease with its own app
  identity and data directory. There is no separate R2 feed.
- **Failures are local.** A failed apply is discarded (the staged marker is cleared) and the app
  keeps running on the old version. No update is ever applied automatically at quit.
- **Safe Storage caveat.** On macOS, each update is a new ad-hoc build identity, so Keychain asks
  for "Safe Storage" again after an update (see [Opening an unsigned build](#opening-an-unsigned-build)).

Mechanics and risk notes: `agents/risky-areas/updater.md`.

Publishing a release is what makes the check fire for users on the same channel: **Latest** is what
they are told about. Mark a bad release as a prerelease (see [Rolling back](#rolling-back)) and the
updater stops offering it; users who already applied it update to the next good build by hand, since
the updater never downgrades.

## Versioning

The desktop app starts at **0.1.0** (upstream Emdash was 1.2.4). Before changing it we checked that
nothing keys state or migrations off the version number:

- **DB migrations** are drizzle's, keyed by the migration journal and file hashes (`drizzle/meta/_journal.json`), not the app version.
- **userData** is `ninebrains` (`USER_DATA_DIR_NAME`), with no version in the path.
- **Remote workspace-server** installs resolve the version from the server channel pointer and the
  protocol major (`workspace-server/provision/installer.ts`), independent of the desktop version.
- **`app.getVersion()`** is only displayed (About menu, recovery window), sent as handshake or
  telemetry metadata (telemetry is off), or used by the updater (version comparison).
  `resolveAppVersion`'s `package.json` fallback only matches a package named `emdash`, which is dead
  code in both upstream and here.
- **Canary** versions are derived: `0.1.0` becomes `0.1.1-canary.<run>` (`scripts/release/lib/version.ts`).
- **Downgrades.** Our updater refuses to downgrade or reinstall — it only shortlists strictly newer
  SemVer versions — so a user who applied a bad build moves off it via the next good build.

## Local verification (2026-09-10, macOS 26 arm64)

Command: `build.ts --platform mac --arch arm64 --targets dmg` (local mode, no signing env).

| Check | Result |
|---|---|
| Artifact | `Ninebrains-0.1.0-mac-arm64.dmg`, 227,193,328 bytes (216.7 MiB); the unpacked `.app` is 764 MB |
| Bundle | `CFBundleIdentifier` `dev.advancelabs.ninebrains`, name and executable `Ninebrains`, version `0.1.0` |
| Icon | `icon.icns` is byte-identical to `src/assets/images/emdash/emdash.icns`, the asset the fork ships today |
| Signature | `Signature=adhoc`, `flags=(adhoc,runtime)`; `codesign --verify --deep --strict` passes on the app inside the dmg; notarization skipped |
| SEC-36 | no `Contents/Resources/app-update.yml` (electron-updater removed; the updater reads the GitHub release directly); builder reported "Prepared 0 local update manifest(s)" |
| Launch | Starts from the mounted dmg and takes its singleton lock in `~/Library/Application Support/ninebrains`; no `emdash` directory is created. Boot then waits on the Keychain prompt above (the key was created earlier by an e2e run with a different signature). With `--use-mock-keychain` it boots fully (20 processes, services running). |
| Checksums | `checksums.mjs release` wrote `SHA256SUMS` and `SHA256SUMS.json`; `--verify` and `shasum -a 256 -c SHA256SUMS` both pass |

Found and fixed: `build.ts` copied `release/` out of the deploy dir with `cpSync` but without
`verbatimSymlinks`. Node rewrote the `.framework` symlinks to absolute paths into the deploy dir,
which is deleted afterwards, so the copied `release/mac-*/Ninebrains.app` failed
`codesign --verify`, and `verify-mac.ts` in CI would have failed with it. The dmg and zip were not
affected. After the fix, a re-package (`--targets dir`) passes both `codesign --verify --deep
--strict` and `verify-mac.ts`.

Not verified locally: the x64 mac, Windows and Linux builds (they need their runners). The workflow
itself was first dispatched for v0.1.0 on 2026-09-21: run 35555471292 passed every job, attest
included, and the published release has all seven installers and both sums files.

## Threat-model coverage

| Requirement | Status |
|---|---|
| SEC-36: updates are signed with Ninebrains' own Ed25519 key; no upstream owners or feeds | Met. electron-updater is gone (no `app-update.yml`, no `autoUpdater`); the custom updater verifies each release's `SHA256SUMS.json` against the embedded public key before anything downloads or applies; the private key only lives as the `NINEBRAINS_UPDATE_SIGNING_KEY` secret and the signing step fails closed. |
| SEC-36b: nothing is downloaded or installed without the user choosing it | Met. Verified updates only surface a **Download** button; a second user choice (**Restart now**) launches the apply. No auto-download, no `autoInstallOnAppQuit`. |
| SEC-37: `SHA256SUMS` as an asset and in the release notes | Met. |
| SEC-37 test: the workflow re-verifies sums before publishing | Met, twice: before upload, and again after re-downloading the draft. Publishing stays a human step after both. |
| SEC-37: CI builds from a tag | **Deviation.** Dispatch-only, by decision (Actions minutes, and publishing is Lucas's call). The draft is pinned to the built commit, and publishing creates the tag at that commit, so the tag and the bytes still match. |
| SEC-37: provenance attestations | Met. The repo is public, so the `attest` job runs on every release (it passed for v0.1.0). On a private repo it would skip unless repo variable `NINEBRAINS_ATTEST=true` is set on Enterprise Cloud. |
| SEC-37: README documents `shasum -a 256 -c` and `gh attestation verify` | Met. The commands are here; the root README's Download section tells readers to check every download against the release's `SHA256SUMS` and attestation, and links to this file. |
| R8 (accepted): unsigned, checksums and attestations only | Unchanged. |

Every action in `release.yml`, `ci.yml`, `e2e.yml` and the composite actions they use is pinned to
a commit SHA, with the version in a comment. Dependabot (`.github/dependabot.yml`, weekly) opens
the PRs that move the pins. `build-matrix.yml` and `workspace-server-package-check.yml` are
manual-only and still use version tags.

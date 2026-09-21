# Releasing Ninebrains

Ninebrains ships **unsigned**. macOS builds are ad-hoc signed and not notarized, and Windows builds
carry no Authenticode signature. The integrity guarantee comes from the `SHA256SUMS` published with
every release (THREAT-MODEL SEC-37). Auto-update stays off until signing lands (SEC-36). From 0.2.0
the app can *tell* users a new release is out (opt-in, see [Update notice](#update-notice)); users
update with the one-line installer or a manual download.

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

There is no auto-update, so nothing reaches users on its own. Rolling back means stopping new
downloads of a bad build and shipping a good one. The [update notice](#update-notice) and the
one-line installer both follow **Latest**, so step 1 below also stops them pointing at a bad build.
**Never move or reuse a tag**; the workflow refuses a published version, and a changed tag breaks
everyone's checksums.

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

The repo is public now, so the GitHub provider could read a feed without a token. That removed a
practical obstacle, not a reason: the two points above still hold. What the app does instead is the
[update notice](#update-notice), which reads one public API endpoint and never installs anything.

Turning it on is one change that happens after signing:
1. Restore a `github` provider for `Advance-Labs/ninebrains` in both builder configs.
2. Set `UPDATES_ENABLED` to `true`.
3. Update the SEC-36 test to allow exactly that provider.
4. Check electron-updater's signature verification on both OSes before the first update ships.

## Update notice

Code: `apps/emdash-desktop/src/core/features/release-check/`. It is not the updater: it never
imports electron-updater, and `UPDATES_ENABLED` stays `false`.

- **What it does.** Main sends one unauthenticated `GET
  https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest` (10 s timeout, no cookies,
  no token), reads `tag_name`, and compares it with the running version by SemVer precedence, so
  `0.3.0` is newer than `0.3.0-rc.1`. Drafts, prereleases and tags that are not SemVer count as "no
  update". The release link is built from the version, never taken from the response.
- **When.** Only when the user turns on **Settings → General → Check for new versions**
  (`ninebrains.releaseCheck.autoCheck`, default `false`): 30 s after startup, then every 12 h,
  counting any attempt, and only in packaged builds. **Check now** runs one check on demand, at
  most one request a minute. Canary builds never check: `releases/latest` never returns a
  prerelease, and a canary user moves to a newer canary by hand.
- **Why off by default.** SEC-38 says a first run makes no network request the user did not start.
  An automatic check on by default would break that, so it waits for the user.
- **Failures are silent.** Offline, the 60 requests an hour GitHub allows anonymous callers (403 or
  429), any other non-2xx, or a bad body: nothing pops up, the last good answer is kept, and
  Settings shows one plain line about the latest attempt.
- **What the user sees.** A notice at the bottom of the left sidebar, which they can close for that
  version (`dismissedVersion`); a newer release shows it again. Settings → General shows **Download
  Ninebrains X.Y.Z** (opens `https://ninebrains.runs-on.dev/#download`), the installer one-liner for
  their OS with a copy button, and **What's new** (the GitHub release page).
- **0.1.0 has none of this.** 0.2.0 is the first build that can show the notice, so 0.1.0 users
  update by hand once.
- **Threat-model follow-up (open).** `docs/THREAT-MODEL.md` does not yet list this opt-in
  `api.github.com` request. It needs an entry, next to SEC-36 and SEC-38, recording that the call
  is user-enabled or user-initiated, read-only, unauthenticated and never installs anything. This
  PR does not edit the threat model.

Publishing a release is what makes the notice fire, for users who turned it on: **Latest** is what
they are told about. Mark a bad release as a prerelease (see [Rolling back](#rolling-back)) and the
notice stops pointing at it.

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

Not verified locally: the x64 mac, Windows and Linux builds (they need their runners). The workflow
itself was first dispatched for v0.1.0 on 2026-09-21: run 35555471292 passed every job, attest
included, and the published release has all seven installers and both sums files.

## Threat-model coverage

| Requirement | Status |
|---|---|
| SEC-36: no `app-update.yml`, no update timer, `autoInstallOnAppQuit` unreachable, no upstream owner | Met. `publish: null` in both configs; `UPDATES_ENABLED=false` returns before any `autoUpdater` setup; `release-config.test.mjs` rejects a publish provider or `generalaction`. The packaged-app check under Local verification confirms there is no `app-update.yml` in the bundle. |
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

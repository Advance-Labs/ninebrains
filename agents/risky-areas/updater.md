# Risky Area: Updater And Packaging

The in-app updater is a small custom pipeline under `src/main/host/updates/` (electron-updater was
removed). Its one job is to make sure the app only ever runs code whose checksum file was signed by
us, and only when the user asks. See `docs/RELEASING.md` → In-app updates for the release-time view.

## Main Files

- `src/main/host/updates/update-service.ts` — check → offer → download → stage → apply state machine
- `src/main/host/updates/feed.ts` — GitHub Releases feed (stable `latest`, canary prerelease scan)
- `src/main/host/updates/integrity.ts` — Ed25519 signature derivation, encoding and verification
- `src/main/host/updates/download.ts` — streamed artifact download with size/hash checks
- `src/main/host/updates/staging.ts` — staging area + marker; `isSafeArtifactName` path-safety
- `src/main/host/updates/apply/index.ts` — apply-on-next-launch (mac/Linux swap, Windows NSIS)
- `src/main/host/updates/version.ts`, `types.ts` — SemVer ordering and shared types
- `src/core/features/updates/` — Wire domain (contract, controller, store, pill UI)
- `src/core/primitives/app-identity/api/update-signing-key.ts` — the embedded public key
- `scripts/release/sign-update-digest.mjs` — signs `SHA256SUMS.json` in the release job
- `scripts/release/build.ts` — electron-builder, local mode (`--release-id` absent ⇒ no GitHub)
- `scripts/release/checksums.mjs` — `SHA256SUMS` / `SHA256SUMS.json` generation and verification
- `scripts/release/verify-mac.ts`, `verify-linux.ts`, `verify-win.ts` — platform artifact checks
- `electron-builder.config.ts`, `electron-builder.canary.config.ts` — `publish: null`, both
- `.github/workflows/release.yml` — the one release workflow (dispatch-only, stable + canary)
- `build/` — packaging assets (unchanged unless the task is packaging/signing)

Legacy scripts that are **not wired into `release.yml`** (upstream remnants, safe to ignore for
normal work): `scripts/release/{upload-github-assets.ts, finalize-release.ts, notarize-mac.ts,
rebuild-native.ts}` and `scripts/release/lib/{object-promotion,promotion-journal,release-ownership,
release-assets,artifacts,…}.ts`. Don't rely on them in a release; say so when a task touches them.

## Rules

- treat `src/main/host/updates/` and anything the updater runs (spawning the Windows installer,
  moving/removing staged files) as high risk; read this page before editing
- never weaken the trust chain: the Ed25519 public key, the digest comparison against the signed
  `SHA256SUMS.json`, and the "nothing downloads or applies without the user" invariants are the point
- `isSafeArtifactName` bounds every file the updater derives a path from (write *and* delete path
  derive from the validated artifact name, never from a marker's stored path)
- keep build output directories and packaging config stable unless the task is explicitly about
  release behavior
- the signing secret (`NINEBRAINS_UPDATE_SIGNING_KEY`) must never be logged, committed, or embedded;
  only its public half ships in the app

## How an update happens

1. **Check.** Packaged builds only; nothing on dev. 30 s after startup, then hourly
   (`update-service.ts`). `feed.ts` asks `api.github.com/repos/Advance-Labs/ninebrains` for
   `releases/latest` (stable) or scans ten `-canary.N` prereleases (canary), unauthenticated,
   and keeps releases that are SemVer-newer than the running version for the app's channel.
2. **Offer.** A newer verified version shows a **Download** button on the bottom-right pill
   (updates slice store → pill). No artifact is fetched yet.
3. **Download + verify.** `download.ts` streams the platform artifact (and the release's
   `SHA256SUMS.json`) to a staging dir. `integrity.ts` verifies the Ed25519 signature of the checksum
   file against the embedded key, then compares the artifact's SHA-256 to the digest value. Any
   failure discards the file and surfaces an error; the app stays on the old version.
4. **Apply on next launch.** After the user picks **Restart now**, the app quits. On the next
   launch `initialize()` (called after the main window is up) checks the staged marker and applies:
   - macOS/Linux: replace the bundle/AppImage/`.deb` in place (`apply/index.ts`) and relaunch.
   - Windows: the running `.exe` is locked, so `update-service.ts` registers a `will-quit` handler
     that spawns the staged NSIS installer detached for the current user (`/S /D=<app dir>`), after
     `clearPendingUpdateSync` clears the marker; electron-builder's `runAfterFinish: true` restarts
     the app when the install completes.
5. **Failure is local.** A failed apply clears the marker and leaves the old version running. No
   update is ever applied automatically at quit.

## Security invariants

- **Trust anchor is our key, not OS signatures.** Builds are unsigned (ad-hoc / no Authenticode).
  The updater deliberately does not lean on Gatekeeper or SmartScreen, which have nothing to check
  against for an unsigned app. Verification is the Ed25519 signature over `SHA256SUMS.json`; a
  hijacked release or feed cannot forge it (THREAT-MODEL TB6 / SEC-36).
- **No unprompted traffic.** A packaged first run makes no network request: the check starts after
  a 30 s delay and only against `api.github.com` for release metadata (SEC-38).
- **No downgrades.** Version shortlisting is strict SemVer `>`; the app never replaces itself with
  an equal or older build, even from a verified feed.
- **Canary/prerelease isolation.** Canary channel scan only matches `-canary.N` tags; a `-canary`
  app does not see stable releases and vice versa. No R2, no separate channel manifests.

## Packaging interface

- Both builder configs set `publish: null`; electron-builder writes no `app-update.yml`, so there is
  no feed metadata inside the app for a MITM to repoint.
- `release.yml` is the only release entry point (manual dispatch from `main` / `release/*`, stable
  or canary channel). The `release` job writes and verifies `SHA256SUMS`, runs `sign-update-digest.mjs`
  (fails closed without the secret), builds the draft, uploads with `--clobber`, and re-verifies the
  draft's downloaded bytes before it is publishable.
- `build.ts` in local mode never contacts GitHub and drops output in `apps/emdash-desktop/release/`
  (gitignored).

## Current Notes

- Changelog (release notes) and updater behavior are related but separate surfaces; a changelog
  entry does not imply the updater checks were re-run.
- macOS Safe Storage is keyed to the ad-hoc build identity, so each in-app update (a new build)
  re-prompts for the keychain item. Not a code bug; documented in RELEASING.md.
- Test surface that must stay green: `src/main/host/updates/*.test.ts` (unit), the `sign-update-digest`
  node tests run by the root `test:tooling` glob, and `scripts/release/*.test.mjs`.
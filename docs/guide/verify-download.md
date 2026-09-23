---
title: Verify and open a download
description: >-
  Check a Ninebrains release against its SHA256SUMS file, then open the unsigned build past macOS
  Gatekeeper, Windows SmartScreen or a Linux AppImage prompt.
---

Ninebrains builds are **not code-signed** yet. Your protection is the checksum: check it before
you open anything. Only use files from the project's GitHub Releases page.

Unsigned builds do not update themselves. To update, run the one-line installer again, or download
the new release and check it the same way. See [Updating](#updating).

## Release files

| OS | Files |
|---|---|
| macOS | `.dmg` and `.zip`, for Apple silicon (arm64) and Intel (x64) |
| Windows | NSIS installer `.exe`, x64 |
| Linux | `.AppImage` and `.deb`, x64 |

Each release also has a `SHA256SUMS` file.

## Check the checksum

Download `SHA256SUMS` into the same folder as the installer. Then run the command for your OS.

macOS:

```bash
cd ~/Downloads
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Linux:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

Both print `OK` next to the file you downloaded. Anything else means the file is not the one the
release published. Do not open it.

Windows (PowerShell). Replace the file name with the one you downloaded:

```powershell
$expected = (Select-String -Path .\SHA256SUMS -Pattern 'Ninebrains-0.1.0-win-x64.exe').Line.Split(' ')[0]
$actual = (Get-FileHash .\Ninebrains-0.1.0-win-x64.exe -Algorithm SHA256).Hash.ToLower()
if ($actual -eq $expected) { 'OK' } else { 'MISMATCH - do not run this file' }
```

A matching checksum proves you have the exact bytes the release uploaded. It does not prove who
built them.

### Build attestations

Once build attestations are turned on for a release, you can also check where a file was built,
with the GitHub CLI:

```bash
gh attestation verify Ninebrains-0.1.0-mac-arm64.dmg --repo Advance-Labs/ninebrains
```

Releases from 0.1.0 on carry an attestation, made by the release workflow in this repository.

## Open an unsigned build

Do this only after the checksum matches.

### macOS

The one-line installer skips this whole section. It checks the checksum for you, and macOS shows
no warning for an app it installs. That is not a bypass: macOS only quarantines files a browser or
mail app downloads, and the installer downloads with `curl`.

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh
```

For a `.dmg` you downloaded in a browser:

- **macOS 14 and earlier:** right-click (or Control-click) the app, choose **Open**, then **Open**
  again.
- **macOS 15 and later:** try to open the app once. Then go to **System Settings → Privacy &
  Security**, find *"Ninebrains" was blocked*, click **Open Anyway** and enter your password.
- **Any version, from Terminal:**

  ```bash
  xattr -dr com.apple.quarantine /Applications/Ninebrains.app
  ```

  Removing the quarantine flag also skips the check macOS runs on first launch.

#### The Keychain prompt

On first launch, macOS may ask: *"Ninebrains wants to use your confidential information stored in
'Ninebrains Safe Storage' in your keychain"*. Click **Always Allow**. The app encrypts its cookie
store and saved secrets with that key, and it cannot start until you answer. No window appears
while the prompt is open.

An unsigned build has no stable identity, so macOS asks again after every new build. The same
happens if another build (for example a dev build) created the key first. If you click **Deny**,
the app cannot read the key.

### Windows

SmartScreen shows a warning. Click **More info**, then **Run anyway**. On a managed machine,
**Run anyway** may be hidden by policy.

### Linux

AppImage:

```bash
chmod +x Ninebrains-*.AppImage
./Ninebrains-*.AppImage
```

Debian or Ubuntu package:

```bash
sudo apt install ./Ninebrains-*-linux-amd64.deb
```

## Updating

Ninebrains updates itself without the one-line installer. In packaged builds it checks GitHub
Releases for a newer version (once 30 s after startup, then hourly), and shows a **Download**
button at the bottom-right when there is one. Three properties keep this safe for an unsigned app:

- **Signed digest.** Every update is accepted only after the release's `SHA256SUMS.json` verifies
  against an Ed25519 public key embedded in the app (the private half lives only as a GitHub
  secret). A hijacked release or feed cannot forge that signature.
- **User-choice only.** Nothing downloads until you click **Download**, and the new build installs
  only on the launch that follows your **Restart now** choice. There is no automatic download or
  apply-at-quit.
- **Fresh checks.** The downloaded file is re-checked byte-for-byte against the signed digest
  before the update counts as ready; a mismatch is discarded.

### Update in one line

The same line that installs Ninebrains updates it, and still works if you prefer it.

macOS and Linux:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh
```

Windows (PowerShell):

```powershell
irm https://ninebrains.runs-on.dev/install.ps1 | iex
```

Your projects, settings and history live in the app's data folder, which the installer does not
touch.

**Which file it installs.** The installer picks the file for your OS and CPU:

- **macOS:** the `.zip` for your Mac (Apple silicon or Intel), not the `.dmg`. It goes into
  `/Applications` if you can write there, otherwise `~/Applications`, and never uses `sudo`.
- **Linux x86_64:** the `.AppImage`, into `~/.local/bin` (with a `ninebrains` link and a menu
  entry). Other Linux CPUs have no build yet, so the installer stops and points you to
  [Install from source](install-from-source.md).
- **Windows:** the x64 installer, always installed for the current user only (`/S /currentuser`).
  Windows on Arm gets the x64 build, which runs under emulation. If Ninebrains is installed for
  all users (per machine), the script stops with a message instead of adding a second copy, unless
  you pass `-Force`.

If you installed the `.deb`, update it with the `.deb` too. The default line installs the
AppImage alongside it instead:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh -s -- --deb
```

That runs `sudo apt install`, so it asks for your password.

**If Ninebrains is running.** On macOS the installer asks you to quit it first and waits. On
Windows it stops unless you pass `-Force`. On Linux the AppImage file is swapped in place; restart
Ninebrains to use the new version.

**What the installer checks.** It downloads the file and the release's `SHA256SUMS` from the same
GitHub release, and stops before installing anything if the file does not match its line in
`SHA256SUMS`. On macOS it also checks that the app bundle's ad-hoc signature is internally
consistent (not who signed it), and its bundle ID and version, before it replaces the installed
app.

**What that does not prove.** The checksum and the file come from the same release. It catches a
corrupted or swapped download, not a compromised release: someone who could publish a release
could publish matching sums. The build attestation closes more of that gap. If the GitHub CLI
(`gh`) is installed and signed in, the installer runs `gh attestation verify` for you, and if that
check fails, **nothing is installed**. Without `gh`, it relies on the checksum alone and says so.

### Installer options

A piped script needs `sh -s --` (macOS, Linux) or the scriptblock form (Windows) to take options;
`irm … | iex` cannot pass any.

| What | macOS, Linux | Windows |
|---|---|---|
| Require the attestation check (fail if `gh` is missing or signed out) | `curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install \| sh -s -- --require-attestation` | `& ([scriptblock]::Create((irm https://ninebrains.runs-on.dev/install.ps1))) -RequireAttestation` |
| Skip the attestation check | `… \| sh -s -- --no-attestation` | `… -NoAttestation` |
| Update a `.deb` install (Linux) | `… \| sh -s -- --deb` | |
| Install over a running app or a same-version install | `… \| sh -s -- --force` | `… -Force` |
| Show what would happen, change nothing | `… \| sh -s -- --dry-run` | `… -DryRun` |

To check a file yourself:

```bash
gh attestation verify Ninebrains-0.2.0-mac-arm64.zip --repo Advance-Labs/ninebrains
```

Piping a script into a shell trusts that script. To read it first, open the URL in a browser, or
download it, read it, then run it.

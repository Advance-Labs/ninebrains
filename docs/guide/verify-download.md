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

Ninebrains never downloads or installs an update by itself. An unsigned app that replaced itself
from the network would run whatever the release feed served, with nothing to check it against, so
in-app updates stay off until builds are signed.

### Hear about a new release

Turn on **Settings → General → Check for new versions** (0.2.0 and later). Once after startup and
every 12 hours, the app sends one request to `api.github.com` for the latest release, with no
account or token. If a newer version exists, a notice appears at the bottom of the left sidebar;
close it and it stays closed until the next release. Settings → General shows a **Download** button
(it opens [ninebrains.runs-on.dev](https://ninebrains.runs-on.dev/#download) in your browser), the
installer line for your OS with a copy button, and a link to the release notes.

The setting is off by default, so a fresh install makes no request you did not ask for. **Check
now** on the same page runs one check whenever you press it. Canary builds never check. 0.1.0 has
no notice at all; update it by hand once.

### Update in one line

The same line that installs Ninebrains updates it.

macOS and Linux:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh
```

Windows (PowerShell):

```powershell
irm https://ninebrains.runs-on.dev/install.ps1 | iex
```

Quit Ninebrains first. Your projects, settings and history live in the app's data folder, which
the installer does not touch.

**What the installer checks.** It downloads the installer for your OS and CPU, and the
`SHA256SUMS` file, from the same GitHub release, and refuses to continue if the file does not
match its line in `SHA256SUMS`. On macOS it also checks the app bundle's signature and bundle ID
before replacing the installed app.

**What that does not prove.** The checksum and the file come from the same release. It catches a
corrupted or swapped download, not a compromised release: someone who could publish a release
could publish matching sums. The build attestation closes more of that gap. With the GitHub CLI
installed and logged in, the installer also runs `gh attestation verify` for you; pass
`--require-attestation` to make that step mandatory. To check a file yourself:

```bash
gh attestation verify Ninebrains-0.2.0-mac-arm64.zip --repo Advance-Labs/ninebrains
```

Piping a script into a shell trusts that script. To read it first, open the URL in a browser, or
download it, read it, then run it.

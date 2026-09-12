---
title: Verify and open a download
description: >-
  Check a Ninebrains release against its SHA256SUMS file, then open the unsigned build past macOS
  Gatekeeper, Windows SmartScreen or a Linux AppImage prompt.
---

v0.1 builds are **not code-signed**. Your protection is the checksum: check it before you open
anything. Only use files from the project's GitHub Releases page.

Unsigned builds do not update themselves. To update, download the new release and check it the
same way.

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

Attestations are not produced while the repository is private.

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

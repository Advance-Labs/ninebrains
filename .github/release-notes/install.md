## Install or update in one line

The installer picks the file for your OS and CPU (the `.zip` on macOS, the AppImage into
`~/.local/bin` on Linux x86_64, the x64 installer for the current user on Windows, including
Windows on Arm), downloads it from the latest release on this repository, checks it against that
release's `SHA256SUMS`, and installs it. With the GitHub CLI signed in it also runs
`gh attestation verify` and installs nothing if that fails. Run it again to update. It installs the
latest stable release, not canary builds.

```sh
# macOS and Linux
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.dev/install | sh
```

```powershell
# Windows (PowerShell)
irm https://ninebrains.dev/install.ps1 | iex
```

Prefer to do it by hand? Follow the steps below.

## How to install

**1. Check the download.** Compare your file against the `SHA256SUMS` block at the bottom of this
page before you open it. Only bypass the warnings below for a file whose hash matches and that you
downloaded from this page. More detail, including every step below:
[Verify and open a download](https://ninebrains.dev/docs/verify-download/).

**2. Open it on your platform.**

### macOS

<!-- stable-only -->
**Easiest: the one-line installer.** It downloads the build for your Mac, checks it against
`SHA256SUMS` for you, and installs it into Applications. macOS shows no "unidentified developer"
warning, because only files a browser or mail app downloads get quarantined. Run it again to update.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.dev/install | sh
```

**Or download the disk image.**
<!-- /stable-only -->
Download the `.dmg` for your Mac: `mac-arm64` for Apple silicon (M1 and later), `mac-x64` for
Intel. Open it and drag **{{PRODUCT}}** into **Applications**. The first launch says the app "can't
be opened because Apple cannot check it for malicious software". Pick one of these:

- **macOS 15 (Sequoia) and later:** try to open the app once, then go to **System Settings →
  Privacy & Security**, scroll to *"{{PRODUCT}}" was blocked*, click **Open Anyway** and confirm
  with your password.
- **macOS 14 and earlier:** in Finder, right-click (or Control-click) `{{PRODUCT}}.app` → **Open**
  → **Open**. You only need to do this once.
- **Terminal, any version:** remove the quarantine flag from the installed app.
  ```sh
  xattr -dr com.apple.quarantine "/Applications/{{PRODUCT}}.app"
  ```

On first launch macOS may also ask whether {{PRODUCT}} can use *"{{PRODUCT}} Safe Storage"* in your
keychain. Click **Always Allow**. The app cannot start until you answer, and no window appears
while that prompt is open. Unsigned builds have no stable identity, so macOS asks again after each
new version.

### Windows

Run `{{FILE_PREFIX}}-win-x64.exe`. When you see "Windows protected your PC", click **More info** →
**Run anyway**. Some managed or work machines hide **Run anyway**; on those you need an
administrator.

### Linux

No warning to get past. Use either package:

```sh
chmod +x {{FILE_PREFIX}}-linux-x86_64.AppImage && ./{{FILE_PREFIX}}-linux-x86_64.AppImage
# or
sudo apt install ./{{FILE_PREFIX}}-linux-amd64.deb
```

Stuck? See [Troubleshooting](https://ninebrains.dev/docs/troubleshooting/).

## Updating

{{PRODUCT}} updates itself. In packaged builds it checks GitHub Releases for a newer version (once
30 seconds after startup, then hourly) and shows a **Download** button when there is one; each
update is accepted only after its checksum file verifies against an Ed25519 key embedded in the
app, nothing downloads until you click, and the install happens on the launch that follows your
**Restart now** choice. macOS and Linux swap in the new build in place; Windows runs the new
installer at quit and relaunches. Your projects and settings are kept.

The one-line installer above also still updates a running install, same checks and same versions:

- **Installed the `.deb`?** Update with
  `curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.dev/install | sh -s -- --deb`
  (it runs `sudo apt install`). The plain line installs the AppImage instead.
- **App running?** macOS asks you to quit it; Windows stops unless you pass `-Force`; the Linux
  AppImage is swapped in place, so restart it.
- **Windows** installs for the current user only. An all-users install makes the script stop with
  a message unless you pass `-Force`.
- **Options** (`--require-attestation`, `--no-attestation`, `--dry-run`): add them after
  `sh -s --` in the curl line. On Windows, `irm … | iex` takes no options; use
  `& ([scriptblock]::Create((irm https://ninebrains.dev/install.ps1))) -RequireAttestation`.

Canary builds update from canary releases only, and an update never downgrades you: after a bad
release, update to the next good one rather than back to an older version.

## Documentation

- [Getting started](https://ninebrains.dev/docs/getting-started/): install, add a project, start agents in lanes, hand the Brain its first brief
- [First run](https://ninebrains.dev/docs/first-run/): the import step, the hooks added to Claude Code and Codex, connecting GitHub
- [Verify and open a download](https://ninebrains.dev/docs/verify-download/): checksums, then getting past Gatekeeper and SmartScreen
- [Troubleshooting](https://ninebrains.dev/docs/troubleshooting/): fixes for common problems, including unsigned-build and Keychain prompts
- [Security overview](https://ninebrains.dev/docs/security/): how Ninebrains contains agents that run commands on your machine
- [Install from source](https://ninebrains.dev/docs/install-from-source/): build it yourself instead
- [All docs](https://ninebrains.dev/docs/)

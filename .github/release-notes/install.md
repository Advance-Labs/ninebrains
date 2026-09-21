## Install or update in one line

The installer picks the right file for your machine, downloads it from the latest release on this
repository, checks it against that release's `SHA256SUMS`, and installs it. Run it again to update.
It installs the latest stable release, not canary builds.

```sh
# macOS and Linux
curl --proto '=https' --tlsv1.2 -fsSL https://ninebrains.runs-on.dev/install | sh
```

```powershell
# Windows (PowerShell)
irm https://ninebrains.runs-on.dev/install.ps1 | iex
```

Prefer to do it by hand? Follow the steps below.

## How to install

**1. Check the download.** Compare your file against the `SHA256SUMS` block at the bottom of this
page before you open it. Only bypass the warnings below for a file whose hash matches and that you
downloaded from this page. More detail, including every step below:
[Verify and open a download](https://docs.advancelabs.dev/ninebrains/verify-download/).

**2. Open it on your platform.**

### macOS

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

Stuck? See [Troubleshooting](https://docs.advancelabs.dev/ninebrains/troubleshooting/).

## Updating

{{PRODUCT}} does not update itself: an unsigned app should not replace its own code from the
network. To update, quit the app and run the one-line installer above again, or download the new
files from this page and install them over the old version. Your projects and settings are kept.

From 0.2.0 on, **Settings → General → Check for new versions** (off by default) tells you when a
new release is out, and shows the download link and the installer line to copy. Nothing is
downloaded or installed for you. 0.1.0 has no such notice.

## Documentation

- [Getting started](https://docs.advancelabs.dev/ninebrains/getting-started/): install, add a project, start agents in lanes, hand the Brain its first brief
- [First run](https://docs.advancelabs.dev/ninebrains/first-run/): the import step, the hooks added to Claude Code and Codex, connecting GitHub
- [Verify and open a download](https://docs.advancelabs.dev/ninebrains/verify-download/): checksums, then getting past Gatekeeper and SmartScreen
- [Troubleshooting](https://docs.advancelabs.dev/ninebrains/troubleshooting/): fixes for common problems, including unsigned-build and Keychain prompts
- [Security overview](https://docs.advancelabs.dev/ninebrains/security/): how Ninebrains contains agents that run commands on your machine
- [Install from source](https://docs.advancelabs.dev/ninebrains/install-from-source/): build it yourself instead
- [All docs](https://docs.advancelabs.dev/ninebrains/)

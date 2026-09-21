# Ninebrains installer and updater for Windows.
#
#   irm https://ninebrains.runs-on.dev/install.ps1 | iex
#
# With options (the scriptblock form passes them through):
#
#   & ([scriptblock]::Create((irm https://ninebrains.runs-on.dev/install.ps1))) -Version 0.2.0 -DryRun
#
# Options: -Version X.Y.Z (or env NINEBRAINS_VERSION), -DryRun, -Force, -RequireAttestation,
# -NoAttestation, -Help.
#
# Run it again to update. It downloads one release from
# https://github.com/Advance-Labs/ninebrains/releases, checks the installer against that release's
# SHA256SUMS, and only then runs it silently for your user (no administrator prompt). It never
# changes your execution policy.
#
# The whole script is one function called on the last line, so a download cut off halfway runs
# nothing. Source: apps/site/public/install.ps1 in https://github.com/Advance-Labs/ninebrains.

function Install-Ninebrains {
  [CmdletBinding()]
  param(
    [string]$Version = $env:NINEBRAINS_VERSION,
    [switch]$DryRun,
    [switch]$Force,
    [switch]$RequireAttestation,
    [switch]$NoAttestation,
    [switch]$Help
  )

  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $Repo = 'Advance-Labs/ninebrains'
  $ApiLatest = "https://api.github.com/repos/$Repo/releases/latest"
  $WebLatest = "https://github.com/$Repo/releases/latest"
  $DownloadBase = "https://github.com/$Repo/releases/download"
  $SignerWorkflow = "$Repo/.github/workflows/release.yml"
  $VerifyDocs = 'https://docs.advancelabs.dev/ninebrains/verify-download/'
  $VersionPattern = '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'

  function Say([string]$Message) { Write-Host "ninebrains: $Message" }
  function Fail([string]$Message) { throw "ninebrains: error: $Message" }

  if ($Help) {
    @"
Install or update Ninebrains on Windows (x64; Windows on Arm runs it under emulation).

  irm https://ninebrains.runs-on.dev/install.ps1 | iex
  & ([scriptblock]::Create((irm https://ninebrains.runs-on.dev/install.ps1))) [options]

Options:
  -Version X.Y.Z        Install this release instead of the latest (env NINEBRAINS_VERSION).
  -DryRun               Resolve the release and print what would happen; download nothing big.
  -Force                Reinstall the same version, and install while Ninebrains is running.
  -RequireAttestation   Fail unless GitHub build provenance is verified (needs gh, signed in).
  -NoAttestation        Skip the provenance check even when gh is available.
  -Help                 Show this help.

Every download is checked against the release's SHA256SUMS. That catches a corrupted or swapped
file; it cannot catch a compromised release, since both come from the same place. With the GitHub
CLI signed in, the installer also runs 'gh attestation verify'. More: $VerifyDocs
"@ | Write-Host
    return
  }

  $tmp = $null
  try {
    if ($NoAttestation -and $RequireAttestation) {
      Fail '-NoAttestation and -RequireAttestation conflict'
    }

    # Windows PowerShell 5.1 may default to TLS 1.0; GitHub needs 1.2 or newer. Adds, never removes.
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    if (-not [Environment]::Is64BitOperatingSystem) {
      Fail 'Ninebrains needs 64-bit Windows.'
    }
    $cpu = $env:PROCESSOR_ARCHITEW6432
    if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
    if ($cpu -eq 'ARM64') {
      Say 'Windows on Arm: installing the x64 build, which runs under emulation.'
    }

    # Resolve the release tag once; everything after downloads from that tag only.
    if ($Version) {
      $Version = $Version -replace '^v', ''
      if ($Version -notmatch $VersionPattern) {
        Fail "invalid version '$Version'; expected X.Y.Z or X.Y.Z-suffix"
      }
    } else {
      $tag = $null
      try {
        $release = Invoke-RestMethod -Uri $ApiLatest -UseBasicParsing -TimeoutSec 30 `
          -Headers @{ 'User-Agent' = 'ninebrains-installer'; 'Accept' = 'application/vnd.github+json' }
        $tag = [string]$release.tag_name
      } catch {
        Write-Warning 'ninebrains: GitHub API unavailable (rate limit or network); reading the releases/latest redirect'
      }
      if (-not $tag) {
        try {
          $request = [System.Net.HttpWebRequest]::Create($WebLatest)
          $request.AllowAutoRedirect = $false
          $request.Method = 'HEAD'
          $request.UserAgent = 'ninebrains-installer'
          $response = $request.GetResponse()
          $location = $response.Headers['Location']
          $response.Close()
          $prefix = "https://github.com/$Repo/releases/tag/"
          if ($location -and $location.StartsWith($prefix, [StringComparison]::Ordinal)) {
            $tag = $location.Substring($prefix.Length)
          }
        } catch {
          $tag = $null
        }
      }
      if (-not $tag) {
        Fail 'could not find the latest release. Check your connection, or pass -Version X.Y.Z'
      }
      if (-not $tag.StartsWith('v', [StringComparison]::Ordinal)) {
        Fail "unexpected release tag '$tag'"
      }
      $Version = $tag.Substring(1)
      if ($Version -notmatch $VersionPattern) { Fail "unexpected release tag '$tag'" }
    }

    $asset = "Ninebrains-$Version-win-x64.exe"
    $base = "$DownloadBase/v$Version"

    # An existing per-user or per-machine install, from the uninstall entry the NSIS installer writes.
    $installed = $null
    foreach ($root in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
      )) {
      $entry = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'Ninebrains *' -or $_.DisplayName -eq 'Ninebrains' } |
        Where-Object { $_.DisplayName -notlike 'Ninebrains Canary*' } |
        Select-Object -First 1
      if ($entry) {
        $installed = $entry
        break
      }
    }
    $oldVersion = if ($installed) { [string]$installed.DisplayVersion } else { '' }

    Say "platform  Windows x64"
    Say "release   v$Version"
    Say "file      $base/$asset"
    Say "install   for the current user (NSIS /S /currentuser)"
    if ($oldVersion) { Say "installed $oldVersion" }

    if ($oldVersion -eq $Version -and -not $Force) {
      Say "Ninebrains $Version is already installed. Nothing to do (-Force reinstalls)."
      return
    }

    if (Get-Process -Name 'Ninebrains' -ErrorAction SilentlyContinue) {
      if ($DryRun) {
        Say 'Ninebrains is running; a real run would stop here unless you pass -Force'
      } elseif (-not $Force) {
        Fail 'Ninebrains is running. Quit it and run this again, or pass -Force to install anyway.'
      }
    }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ninebrains-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null

    $sumsPath = Join-Path $tmp 'SHA256SUMS'
    try {
      Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing -TimeoutSec 60
    } catch {
      Fail "could not download SHA256SUMS for v$Version. Does that release exist? $WebLatest"
    }
    $entries = @(Get-Content -Path $sumsPath | ForEach-Object {
        $parts = $_ -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1] -ceq $asset) { $parts[0] }
      })
    if ($entries.Count -ne 1) {
      Fail "SHA256SUMS has $($entries.Count) entries for $asset (need exactly 1); not installing"
    }
    $expected = $entries[0]
    if ($expected -notmatch '^[0-9a-fA-F]{64}$') { Fail "SHA256SUMS entry for $asset is malformed" }
    Say "expected  sha256 $($expected.ToLowerInvariant())"

    if ($DryRun) {
      Say "dry run: would download $asset, check it against SHA256SUMS, then run it with /S /currentuser"
      return
    }

    $exe = Join-Path $tmp $asset
    Say "downloading $asset"
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $exe -UseBasicParsing -TimeoutSec 1800
    $actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash
    # -ne is case-insensitive in PowerShell; hex case differs between tools.
    if ($actual -ne $expected) {
      Fail "checksum mismatch for $asset`n  expected $expected`n  got      $actual`nThe download is not the file the release published. Nothing was installed."
    }
    Say "checksum ok ($($actual.ToLowerInvariant()))"

    $provenance = 'not checked (install the GitHub CLI and run gh auth login to check it)'
    if ($NoAttestation) {
      $provenance = 'not checked (-NoAttestation)'
    } else {
      $gh = Get-Command gh -ErrorAction SilentlyContinue
      $ghReady = $false
      if ($gh) {
        & $gh.Source attestation --help *> $null
        if ($LASTEXITCODE -eq 0) {
          & $gh.Source auth status *> $null
          $ghReady = ($LASTEXITCODE -eq 0)
        }
      }
      if ($ghReady) {
        Say 'checking build provenance with gh attestation verify'
        $log = & $gh.Source attestation verify $exe --repo $Repo --signer-workflow $SignerWorkflow 2>&1
        if ($LASTEXITCODE -ne 0) {
          $log | ForEach-Object { Write-Host $_ }
          Fail "gh attestation verify failed for $asset; not installing. Pass -NoAttestation to rely on the checksum alone."
        }
        $provenance = "verified: built by $SignerWorkflow (gh attestation verify)"
      } elseif ($RequireAttestation) {
        Fail '-RequireAttestation needs the GitHub CLI (gh) installed and signed in (gh auth login)'
      }
    }

    Say 'running the installer silently for the current user'
    $process = Start-Process -FilePath $exe -ArgumentList '/S', '/currentuser' -Wait -PassThru
    if ($process.ExitCode -ne 0) { Fail "the installer exited with code $($process.ExitCode)" }

    if (-not $oldVersion) {
      Say "Installed Ninebrains $Version"
    } elseif ($oldVersion -eq $Version) {
      Say "Reinstalled Ninebrains $Version"
    } else {
      Say "Updated Ninebrains $oldVersion -> $Version"
    }
    Say "verified  sha256 matches the release's SHA256SUMS (catches a corrupted or swapped file,"
    Say '          not a compromised release)'
    Say "provenance $provenance"
    Say 'signature the installer is not code-signed. SmartScreen may still warn when you open'
    Say "          Ninebrains, and a managed PC may block it. More: $VerifyDocs"
    Say 'Open it from the Start menu. To update later, run the same command again.'
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    # Report failure without 'exit', which would close the window that ran 'irm | iex'.
    $global:LASTEXITCODE = 1
  } finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

Install-Ninebrains @args

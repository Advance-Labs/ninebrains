/**
 * The one-line installers (`public/install`, `public/install.ps1`) run as `curl | sh` and
 * `irm | iex`, so they are tested hard and offline: the sh script runs against a PATH of fake
 * `curl`, `uname`, `sysctl`, `pgrep` and `gh` that serve fixtures, never the network.
 * `shellcheck` and `pwsh` checks run when those tools are installed (they are on ubuntu CI).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALL = join(APP, 'public', 'install');
const INSTALL_PS1 = join(APP, 'public', 'install.ps1');
const sh = readFileSync(INSTALL, 'utf8');
const ps1 = readFileSync(INSTALL_PS1, 'utf8');

const REPO_URL = 'https://github.com/Advance-Labs/ninebrains';
const API_LATEST = 'https://api.github.com/repos/Advance-Labs/ninebrains/releases/latest';
const WEB_LATEST = `${REPO_URL}/releases/latest`;
const download = (version, file) => `${REPO_URL}/releases/download/v${version}/${file}`;
const CERT_IDENTITY_REGEX =
  '^https://github\\.com/Advance-Labs/ninebrains/\\.github/workflows/release\\.yml@refs/heads/(main|release/[^@]+)$';

/** An AppImage only has to look like an ELF file to the installer. */
const APPIMAGE = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('fake')]);
const ZIP = Buffer.from('PK fake zip');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function which(tool) {
  try {
    return execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const FAKE_CURL = `#!/bin/sh
# Serves $FAKE_FIXTURES/<url with non-alphanumerics as _>; logs every URL; refuses a call without
# the https-only and TLS 1.2 flags.
out=''; url=''; proto=0; tls=0
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift ;;
    --proto) [ "$2" = '=https' ] && proto=1; shift ;;
    --tlsv1.2) tls=1 ;;
    --retry | --connect-timeout | -H) shift ;;
    https://* | http://*) url=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" >>"$FAKE_LOG"
if [ "$proto" != 1 ] || [ "$tls" != 1 ]; then echo "fake curl: missing --proto =https --tlsv1.2" >&2; exit 98; fi
f="$FAKE_FIXTURES/$(printf '%s' "$url" | tr -c 'A-Za-z0-9' '_')"
[ -f "$f" ] || exit 22
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
`;

const FAKES = {
  curl: FAKE_CURL,
  uname: `#!/bin/sh
case $1 in -s) echo "$FAKE_OS" ;; -m) echo "$FAKE_ARCH" ;; *) echo "$FAKE_OS" ;; esac
`,
  sysctl: `#!/bin/sh
[ -n "\${FAKE_ARM64:-}" ] || exit 1
echo "$FAKE_ARM64"
`,
  pgrep: `#!/bin/sh
exit "\${FAKE_PGREP:-1}"
`,
  gh: `#!/bin/sh
printf 'gh %s\\n' "$*" >>"$FAKE_LOG"
case "$1 $2" in
  'attestation --help') exit 0 ;;
  'auth status') exit "\${FAKE_GH_AUTH:-1}" ;;
  'attestation verify') exit "\${FAKE_GH_VERIFY:-0}" ;;
esac
exit 1
`,
  // Never reached by the tests below; present so the macOS tool check passes on Linux CI.
  ditto: '#!/bin/sh\nexit 1\n',
  codesign: '#!/bin/sh\nexit 1\n',
};

/**
 * A sandbox: fixtures for one fake release, a fake bin dir first on PATH, and an empty HOME.
 * `release` maps version -> { files: {name: bytes}, sums?: string } served under that tag.
 */
function sandbox({ latest = '0.2.0', api = true, redirect = true, releases } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ninebrains-install-test-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const fixtures = join(root, 'fixtures');
  const home = join(root, 'home');
  for (const dir of [bin, fixtures, home]) mkdirSync(dir);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const serve = (url, body) =>
    writeFileSync(join(fixtures, url.replace(/[^A-Za-z0-9]/g, '_')), body);

  if (api) serve(API_LATEST, JSON.stringify({ tag_name: `v${latest}`, name: `v${latest}` }));
  if (redirect) {
    serve(WEB_LATEST, `HTTP/2 302\r\nlocation: ${REPO_URL}/releases/tag/v${latest}\r\n\r\n`);
  }
  const all = releases ?? { [latest]: {} };
  for (const [version, spec] of Object.entries(all)) {
    const files = spec.files ?? {
      [`Ninebrains-${version}-mac-arm64.zip`]: ZIP,
      [`Ninebrains-${version}-mac-x64.zip`]: ZIP,
      [`Ninebrains-${version}-linux-x86_64.AppImage`]: APPIMAGE,
      [`Ninebrains-${version}-linux-amd64.deb`]: Buffer.from('deb'),
    };
    for (const [name, bytes] of Object.entries(files)) serve(download(version, name), bytes);
    const sums =
      spec.sums ??
      Object.entries(files)
        .map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
        .join('\n') + '\n';
    serve(download(version, 'SHA256SUMS'), sums);
  }

  const log = join(root, 'curl.log');
  writeFileSync(log, '');
  return {
    root,
    home,
    log,
    requests: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    env: (extra = {}) => ({
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: root,
      LANG: 'C',
      FAKE_FIXTURES: fixtures,
      FAKE_LOG: log,
      ...extra,
    }),
  };
}

const MAC_ARM = { FAKE_OS: 'Darwin', FAKE_ARCH: 'arm64', FAKE_ARM64: '1' };
const MAC_ROSETTA = { FAKE_OS: 'Darwin', FAKE_ARCH: 'x86_64', FAKE_ARM64: '1' };
const MAC_INTEL = { FAKE_OS: 'Darwin', FAKE_ARCH: 'x86_64' };
const LINUX_X64 = { FAKE_OS: 'Linux', FAKE_ARCH: 'x86_64' };
const LINUX_ARM = { FAKE_OS: 'Linux', FAKE_ARCH: 'aarch64' };

/**
 * Runs the installer in a new session (`detached`), so it has no controlling terminal, exactly
 * like `curl | sh` from a CI job or a non-interactive shell. Resolves { code, stdout, stderr }.
 */
function run(box, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', [INSTALL, ...args], {
      env: box.env(env),
      cwd: box.root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, all: stdout + stderr });
    });
  });
}

describe('install (sh): platform and release resolution', () => {
  test('macOS arm64: dry run resolves the latest tag and names the arm64 zip', async () => {
    const box = sandbox();
    const dir = join(box.root, 'Apps');
    const r = await run(box, ['--dry-run', '--dir', dir], MAC_ARM);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /platform {2}macOS arm64/);
    assert.match(r.stdout, /release {3}v0\.2\.0/);
    assert.ok(r.stdout.includes(download('0.2.0', 'Ninebrains-0.2.0-mac-arm64.zip')), r.stdout);
    assert.ok(r.stdout.includes(join(dir, 'Ninebrains.app')));
    assert.ok(r.stdout.includes(`expected  sha256 ${sha256(ZIP)}`));
    assert.match(r.stdout, /dry run: would download/);
    // Tag resolved once from the API, then only that tag's SHA256SUMS; the zip is not fetched.
    assert.deepEqual(box.requests(), [API_LATEST, download('0.2.0', 'SHA256SUMS')]);
    assert.equal(existsSync(dir), false, 'a dry run creates nothing');
  });

  test('macOS under Rosetta still picks the arm64 build (hw.optional.arm64, not uname -m)', async () => {
    const box = sandbox();
    const r = await run(box, ['--dry-run', '--dir', join(box.root, 'Apps')], MAC_ROSETTA);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Ninebrains-0\.2\.0-mac-arm64\.zip/);
  });

  test('macOS on Intel picks the x64 build', async () => {
    const box = sandbox();
    const r = await run(box, ['--dry-run', '--dir', join(box.root, 'Apps')], MAC_INTEL);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /platform {2}macOS x64/);
    assert.match(r.stdout, /Ninebrains-0\.2\.0-mac-x64\.zip/);
  });

  test('Linux x86_64 defaults to the AppImage in ~/.local/bin', async () => {
    const box = sandbox();
    const r = await run(box, ['--dry-run'], LINUX_X64);
    assert.equal(r.code, 0, r.all);
    assert.ok(r.stdout.includes(download('0.2.0', 'Ninebrains-0.2.0-linux-x86_64.AppImage')));
    assert.ok(r.stdout.includes(join(box.home, '.local/bin/Ninebrains.AppImage')));
  });

  test('Linux --deb names the .deb', async () => {
    const box = sandbox();
    const r = await run(box, ['--dry-run', '--deb'], LINUX_X64);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Ninebrains-0\.2\.0-linux-amd64\.deb/);
  });

  test('Linux arm64 is refused with a pointer to building from source, before any download', async () => {
    const box = sandbox();
    const r = await run(box, ['--dry-run'], LINUX_ARM);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /no Ninebrains build for Linux aarch64/);
    assert.match(r.stderr, /install-from-source/);
    assert.deepEqual(box.requests(), []);
  });

  test('unknown OS and Windows shells are refused', async () => {
    const box = sandbox();
    const bsd = await run(box, ['--dry-run'], { FAKE_OS: 'FreeBSD', FAKE_ARCH: 'amd64' });
    assert.notEqual(bsd.code, 0);
    assert.match(bsd.stderr, /no Ninebrains build for FreeBSD/);
    const git = await run(box, ['--dry-run'], { FAKE_OS: 'MINGW64_NT-10.0', FAKE_ARCH: 'x86_64' });
    assert.notEqual(git.code, 0);
    assert.match(git.stderr, /install\.ps1/);
  });

  test('an explicit --version or NINEBRAINS_VERSION skips the API', async () => {
    const box = sandbox({ releases: { '0.1.0': {}, '0.2.0': {} } });
    const flag = await run(box, ['--dry-run', '--version', 'v0.1.0'], LINUX_X64);
    assert.equal(flag.code, 0, flag.all);
    assert.match(flag.stdout, /Ninebrains-0\.1\.0-linux-x86_64\.AppImage/);
    const env = await run(box, ['--dry-run'], { ...LINUX_X64, NINEBRAINS_VERSION: '0.1.0' });
    assert.equal(env.code, 0, env.all);
    assert.ok(!box.requests().includes(API_LATEST));
  });

  test('a malformed version is refused before any network call', async () => {
    const box = sandbox();
    const bad = [
      '1.2',
      '1.2.3;rm -rf ~',
      '../1.2.3',
      '1.2.3\n4.5.6',
      '1.2.3 ',
      '1.2.3-',
      '1.2.3-.rc',
      '1.2.3-rc..1',
      '1.2.3-rc.',
      '',
    ];
    for (const version of ['1.2.3-rc.1', '1.2.3-canary']) {
      const box = sandbox({ releases: { [version]: {} } });
      const r = await run(box, ['--dry-run', '--version', version], LINUX_X64);
      assert.equal(r.code, 0, `refused ${version}: ${r.all}`);
    }
    for (const version of bad) {
      const r = await run(box, ['--dry-run', `--version=${version}`], LINUX_X64);
      if (version === '') {
        // An empty --version= means "latest", like an unset NINEBRAINS_VERSION.
        assert.equal(r.code, 0, r.all);
        continue;
      }
      assert.notEqual(r.code, 0, `accepted ${JSON.stringify(version)}`);
      assert.match(r.stderr, /invalid version/);
    }
    assert.deepEqual(box.requests(), [API_LATEST, download('0.2.0', 'SHA256SUMS')]);
  });

  test('when the API is rate limited it falls back to the releases/latest redirect', async () => {
    const box = sandbox({ api: false });
    const r = await run(box, ['--dry-run'], LINUX_X64);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stderr, /GitHub API unavailable/);
    assert.match(r.stdout, /release {3}v0\.2\.0/);
    assert.deepEqual(box.requests(), [API_LATEST, WEB_LATEST, download('0.2.0', 'SHA256SUMS')]);
  });

  test('fails clearly when neither the API nor the redirect answers', async () => {
    const box = sandbox({ api: false, redirect: false });
    const r = await run(box, ['--dry-run'], LINUX_X64);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /could not find the latest release/);
  });

  test('a tag that is not v<semver> is refused', async () => {
    for (const tag of ['0.2.0', 'v0.2.0/../../evil', 'vX']) {
      const box = sandbox({ redirect: false });
      writeFileSync(
        join(box.root, 'fixtures', API_LATEST.replace(/[^A-Za-z0-9]/g, '_')),
        JSON.stringify({ tag_name: tag })
      );
      const r = await run(box, ['--dry-run'], LINUX_X64);
      assert.notEqual(r.code, 0, `accepted tag ${tag}`);
      assert.match(r.stderr, /unexpected release tag/);
      assert.deepEqual(box.requests(), [API_LATEST]);
    }
  });

  test('--help prints usage and exits 0; unknown options fail', async () => {
    const box = sandbox();
    const help = await run(box, ['--help'], LINUX_X64);
    assert.equal(help.code, 0);
    for (const flag of [
      '--version',
      '--dir',
      '--deb',
      '--force',
      '--dry-run',
      '--require-attestation',
      '--no-attestation',
    ]) {
      assert.ok(help.stdout.includes(flag), `help misses ${flag}`);
    }
    const bad = await run(box, ['--frobnicate'], LINUX_X64);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /unknown option/);
  });
});

describe('install (sh): verification', () => {
  const appImage = (version) => `Ninebrains-${version}-linux-x86_64.AppImage`;

  test('a checksum mismatch aborts and installs nothing', async () => {
    const box = sandbox({
      releases: {
        '0.2.0': {
          files: { [appImage('0.2.0')]: APPIMAGE },
          sums: `${'0'.repeat(64)}  ${appImage('0.2.0')}\n`,
        },
      },
    });
    const r = await run(box, [], LINUX_X64);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /checksum mismatch/);
    assert.match(r.stderr, /Nothing was installed/);
    assert.equal(existsSync(join(box.home, '.local/bin/Ninebrains.AppImage')), false);
  });

  test('SHA256SUMS must name the file exactly once, by exact name', async () => {
    const name = appImage('0.2.0');
    const cases = {
      missing: `${sha256(APPIMAGE)}  other-file\n`,
      duplicate: `${sha256(APPIMAGE)}  ${name}\n${sha256(APPIMAGE)}  ${name}\n`,
      // A near-miss name must not count as a match.
      prefix: `${sha256(APPIMAGE)}  ${name}.old\n`,
    };
    for (const [label, sums] of Object.entries(cases)) {
      const box = sandbox({ releases: { '0.2.0': { files: { [name]: APPIMAGE }, sums } } });
      const r = await run(box, ['--dry-run'], LINUX_X64);
      assert.notEqual(r.code, 0, `${label} accepted`);
      assert.match(r.stderr, /SHA256SUMS has \d+ entries/);
    }
  });

  test('a download that is not an ELF file is not installed even when the sum matches', async () => {
    const bytes = Buffer.from('#!/bin/sh\necho gotcha\n');
    const box = sandbox({ releases: { '0.2.0': { files: { [appImage('0.2.0')]: bytes } } } });
    const r = await run(box, [], LINUX_X64);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /not an ELF executable/);
    assert.equal(existsSync(join(box.home, '.local/bin/Ninebrains.AppImage')), false);
  });

  test('without gh, provenance is reported as not checked, never as verified', async () => {
    const box = sandbox();
    const r = await run(box, [], LINUX_X64);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /provenance not checked/);
    assert.doesNotMatch(r.stdout, /provenance verified/);
  });

  test('--require-attestation fails when gh is not signed in, before installing', async () => {
    const box = sandbox();
    const r = await run(box, ['--require-attestation'], LINUX_X64);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /--require-attestation needs the GitHub CLI/);
    assert.equal(existsSync(join(box.home, '.local/bin/Ninebrains.AppImage')), false);
  });

  test('with gh signed in, runs gh attestation verify pinned to release.yml on main or release/*', async () => {
    const box = sandbox();
    const r = await run(box, ['--require-attestation'], { ...LINUX_X64, FAKE_GH_AUTH: '0' });
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /provenance verified/);
    const verify = box.requests().find((line) => line.startsWith('gh attestation verify'));
    assert.ok(verify, box.requests().join('\n'));
    assert.ok(
      verify.endsWith(
        `--repo Advance-Labs/ninebrains --cert-identity-regex ${CERT_IDENTITY_REGEX} --deny-self-hosted-runners`
      ),
      verify
    );
    assert.doesNotMatch(verify, /--signer-workflow/);
  });

  test('the certificate identity regex accepts main and release/* and nothing else', () => {
    const identity = new RegExp(CERT_IDENTITY_REGEX);
    const workflow = 'https://github.com/Advance-Labs/ninebrains/.github/workflows/release.yml';
    // v0.1.0's real attestation carries this SAN (checked with gh attestation verify --format json).
    assert.match(`${workflow}@refs/heads/main`, identity);
    assert.match(`${workflow}@refs/heads/release/0.2.0`, identity);
    for (const other of [
      `${workflow}@refs/heads/feature/x`,
      `${workflow}@refs/heads/mainline`,
      `${workflow}@refs/tags/v0.2.0`,
      `${workflow}@refs/pull/1/merge`,
      `${workflow}@refs/heads/release/x@refs/heads/main`,
      'https://github.com/evil/ninebrains/.github/workflows/release.yml@refs/heads/main',
      'https://github.com/Advance-Labs/ninebrains/.github/workflows/ci.yml@refs/heads/main',
    ]) {
      assert.doesNotMatch(other, identity);
    }
    assert.ok(ps1.includes(`$CertIdentityRegex = '${CERT_IDENTITY_REGEX}'`));
  });

  test('a failed attestation aborts; --no-attestation skips it', async () => {
    const box = sandbox();
    const env = { ...LINUX_X64, FAKE_GH_AUTH: '0', FAKE_GH_VERIFY: '1' };
    const failed = await run(box, [], env);
    assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /gh attestation verify failed/);
    assert.equal(existsSync(join(box.home, '.local/bin/Ninebrains.AppImage')), false);

    const skipped = await run(box, ['--no-attestation'], env);
    assert.equal(skipped.code, 0, skipped.all);
    assert.match(skipped.stdout, /provenance not checked \(--no-attestation\)/);

    const both = await run(box, ['--no-attestation', '--require-attestation'], env);
    assert.notEqual(both.code, 0);
    assert.match(both.stderr, /conflict/);
  });
});

describe('install (sh): installing and updating', () => {
  test('Linux: installs the AppImage, a ninebrains link and a menu entry, then updates in place', async () => {
    const box = sandbox({ releases: { '0.1.0': {}, '0.2.0': {} } });
    const bin = join(box.home, '.local/bin');
    const desktop = join(box.home, '.local/share/applications/ninebrains.desktop');

    const first = await run(box, ['--version', '0.1.0'], LINUX_X64);
    assert.equal(first.code, 0, first.all);
    assert.match(first.stdout, /Installed Ninebrains 0\.1\.0/);
    const appImage = join(bin, 'Ninebrains.AppImage');
    assert.deepEqual(readFileSync(appImage), APPIMAGE);
    assert.equal(lstatSync(appImage).mode & 0o777, 0o755);
    assert.equal(readlinkSync(join(bin, 'ninebrains')), 'Ninebrains.AppImage');
    assert.match(readFileSync(desktop, 'utf8'), /^X-AppImage-Version=0\.1\.0$/m);
    assert.match(readFileSync(desktop, 'utf8'), new RegExp(`^Exec="${appImage}" %U$`, 'm'));
    assert.match(first.stdout, /is not on your PATH/);

    const again = await run(box, ['--version', '0.1.0'], LINUX_X64);
    assert.equal(again.code, 0, again.all);
    assert.match(again.stdout, /already installed/);

    const update = await run(box, [], LINUX_X64);
    assert.equal(update.code, 0, update.all);
    assert.match(update.stdout, /Updated Ninebrains 0\.1\.0 -> 0\.2\.0/);
    assert.match(readFileSync(desktop, 'utf8'), /^X-AppImage-Version=0\.2\.0$/m);

    const back = await run(box, ['--version', '0.1.0'], LINUX_X64);
    assert.match(back.stdout, /Downgraded Ninebrains 0\.2\.0 -> 0\.1\.0/);
  });

  test('Linux: --dir installs elsewhere and leaves a non-link ninebrains file alone', async () => {
    const box = sandbox();
    const dir = join(box.root, 'tools');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ninebrains'), 'mine');
    for (const bad of ['tools%U', 'tools\nx']) {
      const refused = await run(box, ['--dir', bad], LINUX_X64);
      assert.notEqual(refused.code, 0, `accepted --dir ${JSON.stringify(bad)}`);
      assert.match(refused.stderr, /--dir must not contain/);
    }
    const r = await run(box, ['--dir', 'tools'], LINUX_X64);
    assert.equal(r.code, 0, r.all);
    assert.ok(existsSync(join(dir, 'Ninebrains.AppImage')));
    assert.equal(readFileSync(join(dir, 'ninebrains'), 'utf8'), 'mine');
    assert.match(r.stderr, /exists and is not a link/);
  });

  test('refuses to replace a symlinked target', async () => {
    const box = sandbox();
    const bin = join(box.home, '.local/bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync('/bin/sh', join(bin, 'Ninebrains.AppImage'));
    const linux = await run(box, [], LINUX_X64);
    assert.notEqual(linux.code, 0);
    assert.match(linux.stderr, /is a symlink; refusing/);
    assert.equal(readlinkSync(join(bin, 'Ninebrains.AppImage')), '/bin/sh');

    const apps = join(box.root, 'Apps');
    mkdirSync(apps);
    symlinkSync(box.root, join(apps, 'Ninebrains.app'));
    const mac = await run(box, ['--dir', apps], MAC_ARM);
    assert.notEqual(mac.code, 0);
    assert.match(mac.stderr, /is a symlink; refusing/);
  });

  test(
    'macOS: refuses to replace an app with a different bundle id',
    {
      skip: process.platform !== 'darwin' && 'needs /usr/libexec/PlistBuddy',
    },
    async () => {
      const box = sandbox();
      const apps = join(box.root, 'Apps');
      const contents = join(apps, 'Ninebrains.app', 'Contents');
      mkdirSync(contents, { recursive: true });
      writeFileSync(
        join(contents, 'Info.plist'),
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>' +
          '<key>CFBundleIdentifier</key><string>com.example.other</string>' +
          '<key>CFBundleShortVersionString</key><string>9.9.9</string></dict></plist>'
      );
      const r = await run(box, ['--dry-run', '--dir', apps], MAC_ARM);
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /bundle id 'com\.example\.other', not dev\.advancelabs\.ninebrains/);
    }
  );

  test('macOS: a running app without a terminal or --force stops before downloading', async () => {
    const box = sandbox();
    const apps = join(box.root, 'Apps');
    const r = await run(box, ['--dir', apps], { ...MAC_ARM, FAKE_PGREP: '0' });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Ninebrains is running\. Quit it and run this again, or pass --force/);
    assert.deepEqual(box.requests(), [API_LATEST]);

    const dry = await run(box, ['--dry-run', '--dir', apps], { ...MAC_ARM, FAKE_PGREP: '0' });
    assert.equal(dry.code, 0, dry.all);
    assert.match(dry.stdout, /a real run would ask you to quit it/);
  });
});

describe('install (sh): script hygiene', () => {
  test('the whole body runs from one function called on the last line', () => {
    const lines = sh.trimEnd().split('\n');
    assert.equal(lines.at(-1), 'main "$@"');
    assert.equal(lines[0], '#!/bin/sh');
    assert.match(sh, /^main\(\) \{\n {2}set -eu$/m);
    // Outside functions, only constant assignments: nothing runs until main is called.
    assert.doesNotMatch(sh, /^(curl|rm|mv|cd|sudo) /m);
  });

  test('every curl call is https-only with TLS 1.2+', () => {
    const calls = sh.split('\n').filter((line) => /^\s*(if\s+)?curl\s/.test(line));
    assert.ok(calls.length >= 3, 'expected curl calls');
    for (const call of calls) {
      assert.ok(call.includes(`--proto '=https' --tlsv1.2`), call);
    }
  });

  test('only contacts the project on GitHub and its own site and docs', () => {
    const allowed = [
      /^https:\/\/github\.com\/Advance-Labs\/ninebrains(\/|\.?$)/,
      /^https:\/\/api\.github\.com\/repos\/Advance-Labs\/ninebrains\//,
      /^https:\/\/github\\\.com\/Advance-Labs\/ninebrains\//,
      // Built from the REPO / $Repo constant, pinned below.
      /^https:\/\/(api\.)?github\.com\/(repos\/)?\$(REPO|Repo)\//,
      // Site and docs are one origin now: /docs is rewritten to the docs project.
      /^https:\/\/ninebrains\.dev\b/,
    ];
    assert.match(sh, /^REPO='Advance-Labs\/ninebrains'$/m);
    assert.match(ps1, /^ {2}\$Repo = 'Advance-Labs\/ninebrains'$/m);
    for (const text of [sh, ps1]) {
      for (const [url] of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        assert.ok(
          allowed.some((pattern) => pattern.test(url)),
          `unexpected URL in installer: ${url}`
        );
      }
    }
  });

  test('never uses sudo except for the opt-in --deb path, and never strips quarantine', () => {
    const sudo = sh.split('\n').filter((line) => /\bsudo\s/.test(line) && !/^\s*#/.test(line));
    for (const line of sudo) {
      assert.match(line, /sudo apt install|never uses sudo|sudo apt install -y|runs as root/, line);
    }
    assert.doesNotMatch(sh, /xattr/);
  });

  // Every severity, including info: ubuntu's shellcheck 0.9 flags SC2015 where 0.11 does not, so
  // the script avoids the constructs either version reports. Show the findings when it fails.
  test('shellcheck is clean', { skip: !which('shellcheck') && 'shellcheck not installed' }, () => {
    try {
      execFileSync('shellcheck', ['--shell=sh', INSTALL], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const version = execFileSync('shellcheck', ['--version'], { encoding: 'utf8' });
      assert.fail(`${version}\n${error.stdout}${error.stderr}`);
    }
  });

  test('parses under dash', { skip: !which('dash') && 'dash not installed' }, () => {
    execFileSync('dash', ['-n', INSTALL], { stdio: 'pipe' });
  });
});

describe('install.ps1', () => {
  test('wraps the body in one function called on the last line', () => {
    const lines = ps1.trimEnd().split('\n');
    assert.equal(lines.at(-1), 'Install-Ninebrains @args');
    assert.match(ps1, /^function Install-Ninebrains \{$/m);
    // `exit` would close the window of whoever ran `irm | iex`.
    assert.doesNotMatch(ps1, /^\s*exit\b/m);
  });

  test('uses TLS 1.2, basic parsing, quiet progress, and never touches execution policy', () => {
    assert.match(ps1, /\[Net\.SecurityProtocolType\]::Tls12/);
    assert.match(ps1, /\$ProgressPreference = 'SilentlyContinue'/);
    for (const call of ps1.match(/Invoke-(WebRequest|RestMethod)[^\n]*/g) ?? []) {
      assert.match(call, /-UseBasicParsing/, call);
    }
    assert.doesNotMatch(ps1, /Set-ExecutionPolicy|-ExecutionPolicy/);
  });

  test('validates the version, checks SHA256SUMS by exact name, then installs silently per user', () => {
    assert.ok(ps1.includes(`'^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z]+(\\.[0-9A-Za-z]+)*)?$'`));
    assert.ok(sh.includes(`'^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z]+(\\.[0-9A-Za-z]+)*)?$'`));
    assert.match(ps1, /-ceq \$asset/);
    assert.match(ps1, /\$entries\.Count -ne 1/);
    assert.match(ps1, /Get-FileHash -Path \$exe -Algorithm SHA256/);
    assert.match(ps1, /\$actual -ne \$expected/);
    assert.match(ps1, /Start-Process -FilePath \$exe -ArgumentList '\/S', '\/currentuser' -Wait/);
    // The hash check must come before the installer runs.
    assert.ok(ps1.indexOf('Get-FileHash') < ps1.indexOf('Start-Process'));
    assert.match(
      ps1,
      /'attestation', 'verify', \$exe, '--repo', \$Repo,\s+'--cert-identity-regex', \$CertIdentityRegex, '--deny-self-hosted-runners'/
    );
    assert.doesNotMatch(ps1, /--signer-workflow/);
    assert.match(ps1, /SmartScreen may still warn/);
  });

  test('runs gh with ErrorActionPreference Continue and judges only the exit code', () => {
    // Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'.
    const helper = ps1.match(/function Invoke-Gh[\s\S]*?\n {6}\}\n/);
    assert.ok(helper, 'no Invoke-Gh helper');
    assert.match(helper[0], /\$ErrorActionPreference = 'Continue'/);
    assert.match(helper[0], /finally \{\s+\$ErrorActionPreference = \$previous/);
    assert.match(helper[0], /Code = \$LASTEXITCODE/);
    // Every gh call goes through the helper.
    const direct = ps1.split('\n').filter((line) => /& \$gh\.Source/.test(line));
    assert.deepEqual(direct, ['          $output = & $gh.Source @GhArgs 2>&1']);
  });

  test('stops next to an all-users install unless -Force, and says so when forced', () => {
    assert.match(ps1, /Find-Install @\('HKCU:/);
    assert.match(ps1, /\$machineInstall = Find-Install @\(\s+'HKLM:/);
    assert.match(ps1, /if \(\$machineInstall -and -not \$Force\)/);
    assert.match(ps1, /would add a second, separate copy/);
    assert.match(
      ps1,
      /Installed per-user Ninebrains \$Version \(an all-users copy \$machineVersion also exists\)/
    );
    // The stop must come before anything is downloaded.
    assert.ok(ps1.indexOf('$machineInstall -and -not $Force') < ps1.indexOf('Invoke-WebRequest'));
  });

  const pwsh = which('pwsh');
  test('parses without errors', { skip: !pwsh && 'pwsh not installed' }, () => {
    const out = execFileSync(
      pwsh,
      [
        '-NoProfile',
        '-Command',
        `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${INSTALL_PS1}', [ref]$null, [ref]$e); $e.Count`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(out.trim(), '0');
  });
});

describe('site build and hosting', () => {
  test('the build copies both installers to the site root unchanged', () => {
    const out = mkdtempSync(join(tmpdir(), 'ninebrains-site-dist-'));
    roots.push(out);
    execFileSync('node', [join(APP, 'build.mjs')], {
      env: { ...process.env, SITE_DIST: out },
      stdio: 'ignore',
    });
    assert.equal(readFileSync(join(out, 'install'), 'utf8'), sh);
    assert.equal(readFileSync(join(out, 'install.ps1'), 'utf8'), ps1);
  });

  test('the build refuses a SITE_DIST it could wrongly delete', () => {
    for (const target of ['/', join(APP, 'src'), join(APP, 'public'), dirname(APP)]) {
      assert.throws(
        () =>
          execFileSync('node', [join(APP, 'build.mjs')], {
            env: { ...process.env, SITE_DIST: target },
            stdio: 'pipe',
          }),
        /SITE_DIST must be inside/,
        `accepted SITE_DIST=${target}`
      );
    }
    assert.ok(existsSync(join(APP, 'src', 'index.html')));
    assert.ok(existsSync(INSTALL));
  });

  test('vercel serves the installers as plain text, briefly cached, not sniffed', () => {
    const config = JSON.parse(readFileSync(join(APP, 'vercel.json'), 'utf8'));
    for (const source of ['/install', '/install.ps1']) {
      const rule = config.headers.find((entry) => entry.source === source);
      assert.ok(rule, `no headers for ${source}`);
      const headers = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
      assert.equal(headers['Content-Type'], 'text/plain; charset=utf-8');
      assert.equal(headers['Cache-Control'], 'public, max-age=300');
      assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    }
  });
});

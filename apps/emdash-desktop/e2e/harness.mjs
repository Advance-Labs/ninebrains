// Electron e2e harness: launches the built app (`pnpm run build` first) with an
// isolated profile, a temp HOME (so hooks, worktrees and shell rc files never
// touch the real ones) and a fake `claude` on PATH (so no real credits are spent).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const appDir = resolve(here, '..');
export const repoRoot = resolve(appDir, '../..');

/** Prefers the w0 fake-agent; falls back to a banner-and-echo stub. */
function resolveFakeClaude() {
  const candidates = [
    process.env.NINEBRAINS_FAKE_CLAUDE,
    join(repoRoot, 'tooling/fake-agent/bin/fake-claude.mjs'),
    join(here, 'stub-claude.mjs'),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function createGitRepo(path) {
  mkdirSync(path, { recursive: true });
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
      cwd: path,
      stdio: 'ignore',
    });
  git('init', '-b', 'main');
  writeFileSync(join(path, 'README.md'), '# lanes e2e fixture\n');
  git('add', '.');
  git('commit', '-m', 'initial commit');
}

function installFakeClaude(home) {
  const fake = resolveFakeClaude();
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, 'claude');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return { bin, fake };
}

export async function launchApp() {
  const root = mkdtempSync(join(tmpdir(), 'ninebrains-e2e-'));
  const home = join(root, 'home');
  const userData = join(root, 'user-data');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  // A present .zshrc keeps zsh from offering new-user setup in `$SHELL -ilc env`.
  writeFileSync(join(home, '.zshrc'), '');
  createGitRepo(repo);
  const { bin, fake } = installFakeClaude(home);

  const env = {
    HOME: home,
    USER: process.env.USER ?? 'e2e',
    LOGNAME: process.env.LOGNAME ?? 'e2e',
    SHELL: '/bin/zsh',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: 'en_US.UTF-8',
    PATH: [
      bin,
      dirname(process.execPath),
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ].join(':'),
    EMDASH_USER_DATA_DIR: userData,
    TELEMETRY_ENABLED: 'false',
    FAKE_AGENT_ARGV_LOG: join(root, 'argv.log'),
  };

  const app = await electron.launch({
    executablePath: require('electron'),
    args: [appDir],
    cwd: appDir,
    env,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, root, repo, fake };
}

/** Sets the window's content area to an exact size, e.g. 1440×900 for screenshots. */
export async function setContentSize(app, width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const [win] = BrowserWindow.getAllWindows();
      win.setContentSize(size.width, size.height);
    },
    { width, height }
  );
}

/** Shrinks the window to its minimum size. */
export async function setMinimumSize(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows();
    const [width, height] = win.getMinimumSize();
    win.setSize(width, height);
    return { width, height };
  });
}

/** Native directory pickers can't be driven, so answer them with `path`. */
export async function stubDirectoryPicker(app, path) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, path);
}

// Electron e2e harness: launches the built app (`pnpm run build` first) with an
// isolated profile, a temp HOME (so hooks, worktrees and shell rc files never
// touch the real ones) and a fake `claude` on PATH (so no real credits are spent).
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * A reviewer run (`claude -p`, e.g. the screenshot gate's visual review) gets a scrubbed env
 * (SEC-13), so FAKE_AGENT_SCRIPT never reaches it. The wrapper then defaults to this script,
 * which approves. Lanes are interactive and keep whatever script the test passed.
 */
const APPROVING_REVIEWER = JSON.stringify([{ say: '{"pass": true, "issues": []}' }]);

/**
 * Attended lanes get the upstream agent env allowlist, not the app's env, so a test's
 * FAKE_AGENT_SCRIPT and FAKE_AGENT_ARGV_LOG are baked into the wrapper as file paths instead.
 * Interactive runs (lanes, Brain sessions) default to the test's lane script; `-p` runs to the
 * approving reviewer.
 *
 * An unattended run (`claude -p`, preset "worker", see `unattended.ts`) gets the SAME narrow env
 * as a reviewer run (SEC-13's `buildUnattendedEnv`/`run-env.ts` allowlist), so it can't carry
 * FAKE_AGENT_SCRIPT either — deliberately: that allowlist is a security control (SEC-40 and
 * friends, docs/THREAT-MODEL.md) and this harness must not widen it. A worker run is
 * distinguishable from a reviewer run by argv alone, with no env needed: only a reviewer's argv
 * carries `--tools=` (`buildClaudePrintArgv`, preset "reviewer"); a worker only ever gets
 * `--allowedTools=`. So the wrapper picks the default script by that argv shape, baked in as a
 * file path at wrapper-creation time — no environment variable crosses the allowlist.
 */
function installFakeClaude(home, { laneScript, unattendedScript, argvLog }) {
  const fake = resolveFakeClaude();
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  const reviewer = join(home, '.fake-agent-reviewer.json');
  writeFileSync(reviewer, APPROVING_REVIEWER);
  const worker = join(home, '.fake-agent-unattended.json');
  writeFileSync(worker, unattendedScript ?? APPROVING_REVIEWER);
  const lane = join(home, '.fake-agent-lane.json');
  if (laneScript) writeFileSync(lane, laneScript);
  const interactive = laneScript
    ? `: "\${FAKE_AGENT_SCRIPT:=${lane}}"; export FAKE_AGENT_SCRIPT`
    : ':';
  const wrapper = join(bin, 'claude');
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      `: "\${FAKE_AGENT_ARGV_LOG:=${argvLog}}"; export FAKE_AGENT_ARGV_LOG`,
      'case " $* " in',
      '  *" -p "*)',
      '    case "$*" in',
      `      *--tools=*) : "\${FAKE_AGENT_SCRIPT:=${reviewer}}" ;;`,
      `      *) : "\${FAKE_AGENT_SCRIPT:=${worker}}" ;;`,
      '    esac',
      '    export FAKE_AGENT_SCRIPT',
      '    ;;',
      `  *) ${interactive} ;;`,
      'esac',
      `exec "${process.execPath}" "${fake}" "$@"`,
      '',
    ].join('\n')
  );
  chmodSync(wrapper, 0o755);
  return { bin, fake };
}

/**
 * `env` adds variables for the app and every agent it spawns (e.g. FAKE_AGENT_SCRIPT).
 * `unattendedScript` is a fake-agent script (JSON string) baked into the wrapper as the default
 * for an unattended `claude -p` (worker preset) run — see `installFakeClaude`'s doc comment for
 * why this can't go through `env`.
 */
export async function launchApp({ env: extraEnv = {}, unattendedScript } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ninebrains-e2e-'));
  const home = join(root, 'home');
  const userData = join(root, 'user-data');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  // A present .zshrc keeps zsh from offering new-user setup in `$SHELL -ilc env`.
  writeFileSync(join(home, '.zshrc'), '');
  createGitRepo(repo);
  const argvLog = join(root, 'argv.log');
  const { bin, fake } = installFakeClaude(home, {
    laneScript: extraEnv.FAKE_AGENT_SCRIPT,
    unattendedScript,
    argvLog,
  });

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
    // Main appends --use-mock-keychain when this is set, so safeStorage never
    // prompts for (or touches) the real macOS login keychain.
    NINEBRAINS_E2E: '1',
    FAKE_AGENT_ARGV_LOG: argvLog,
    // Linux CI runs the suites under xvfb-run: Electron needs its display. Unset on macOS.
    ...Object.fromEntries(
      ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY'].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : []
      )
    ),
    ...extraEnv,
  };

  const app = await electron.launch({
    executablePath: require('electron'),
    // A mock keychain: no "Safe Storage" password prompt on every unsigned rebuild. The window
    // keeps rendering when other windows cover it: an occluded window draws no frames, so page
    // screenshots and visibility checks would wait forever.
    args: [
      '--use-mock-keychain',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      appDir,
    ],
    cwd: appDir,
    env,
  });
  // Main-process output (gate runner, preview detection) for diagnosing a failed run.
  const mainLog = createWriteStream(join(root, 'main.log'));
  app.process().stdout?.pipe(mainLog);
  app.process().stderr?.pipe(mainLog);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, root, repo, fake };
}

/**
 * `app.close()` can hang while the app sits in the tray (docs/FORK.md), so it gets a deadline;
 * past it the app is killed. The test's own verdict stands either way.
 */
export async function closeApp(app, ms = 15_000) {
  let timer;
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => true
    ),
    new Promise((resolve) => (timer = setTimeout(() => resolve(false), ms))),
  ]);
  clearTimeout(timer);
  if (!closed) {
    // Electron's helpers (GPU, renderers) outlive a killed main process, so take them too.
    const pids = descendants(app.process().pid);
    app.process().kill('SIGKILL');
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    process.stderr.write(`app.close() did not return within ${ms} ms; killed the app\n`);
  }
}

/** Every process below `pid`, found before anything is killed (they reparent afterwards). */
function descendants(pid) {
  let children = [];
  try {
    children = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    // pgrep exits 1 when there are none.
  }
  return children.flatMap((child) => [child, ...descendants(child)]);
}

/** A run with no verdict after `ms` is a hang: exit 124, as CI's timeout wrapper does. */
export function hangWatchdog(ms) {
  setTimeout(() => {
    process.stderr.write(`HANG: no verdict within ${ms} ms\n`);
    process.exit(124);
  }, ms).unref();
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

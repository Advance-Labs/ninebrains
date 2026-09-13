import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@core': resolve(__dirname, 'src/core'),
  '@root': resolve(__dirname, '.'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
  '@tooling': resolve(__dirname, 'tooling'),
};

// Ninebrains: EMDASH_TEST_BROWSER=1 forces the browser project on, even under CI. The Ninebrains
// CI workflow sets it in its test-browser job.
const skipBrowserProjects =
  process.env.EMDASH_TEST_BROWSER !== '1' &&
  Boolean(process.env.CI || process.env.EMDASH_TEST_SKIP_BROWSER);

// Ninebrains: suites that spawn real process trees (git, sh, the fake agent). They run in the
// low-concurrency `node-spawn` project, after the main pool, so spawn deadlines hold on a loaded
// host without raising any bound.
const spawnHeavyTests = [
  'src/core/features/gates/node/capabilities/**/*.test.ts',
  'src/core/features/exec-runs/**/*.test.ts',
  'src/core/features/brain/node/stop.test.ts',
  'src/core/features/brain/node/unattended.test.ts',
  'src/core/features/agents/node/override-launch.test.ts',
];

// Node-environment Vitest projects run without Electron. Redirect better-sqlite3 to
// the isolated system-Node build and make Electron unavailable unless a test injects it.
// The root native dependencies stay Electron-compiled for app development.
const systemNodeAlias = {
  ...alias,
  'better-sqlite3': resolve(__dirname, 'tooling/node-deps/node_modules/better-sqlite3'),
  electron: resolve(__dirname, 'tooling/vitest/electron-system-node.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // All existing tests that run in a Node.js environment.
        // Migration tests are excluded — run them via `pnpm run test:migrations`.
        // DB integration tests (*.db.test.ts) are excluded — run under the main-db project.
        // Uses systemNodeAlias so native dependencies resolve to their system-Node
        // test implementations without requiring an installed Electron runtime.
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['src/**/*.test.ts'],
          exclude: [
            '**/_*/**',
            '**/*.db.test.ts',
            '**/*.browser.test.ts',
            'src/renderer/tests/browser/**',
            'src/main/db/tests/migrations/**',
            'src/main/db/legacy-port/**/*.test.ts',
            'src/main/core/**/*.db.test.ts',
            ...spawnHeavyTests,
          ],
        },
      },
      {
        // Ninebrains: the spawn-heavy suites above, two files at a time, after every other
        // project in the run has finished.
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'node-spawn',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: spawnHeavyTests,
          exclude: ['**/_*/**', '**/*.db.test.ts'],
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
      {
        // Main-process integration tests that need a real SQLite connection.
        // Uses systemNodeAlias so native dependencies resolve to their system-Node
        // test implementations without requiring an installed Electron runtime.
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'main-db',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: [
            'src/core/features/**/*.db.test.ts',
            'src/core/services/**/*.db.test.ts',
            'src/main/core/**/*.db.test.ts',
            'src/main/db/legacy-port/**/*.test.ts',
            'src/main/host/**/*.db.test.ts',
            'src/services/**/*.db.test.ts',
          ],
        },
      },
      {
        // Fixture generator — run explicitly via `pnpm run db:fixtures`.
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'fixtures',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['tooling/generate-fixtures.ts'],
        },
      },
      {
        // Migration tests — run explicitly via `pnpm run test:migrations`.
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'migrations',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['src/main/db/tests/migrations/**/*.test.ts'],
        },
      },
      {
        // Release script unit tests (artifacts, version helpers).
        extends: true,
        resolve: { alias: systemNodeAlias },
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
      // CI omits the browser project until Playwright provisioning is proven
      // stable there. EMDASH_TEST_SKIP_BROWSER provides the same escape hatch
      // for local runs.
      ...(skipBrowserProjects
        ? []
        : [
            {
              // Renderer tests that need a real browser environment (real CSS
              // layout, ResizeObserver, requestAnimationFrame, WebGL), plus
              // slice-isolation tests colocated with core slices as
              // *.browser.test.{ts,tsx}.
              extends: true as const,
              // Ninebrains: Vite's dep scan misses the automatic JSX runtime, finds it on the
              // first render and reloads mid-run. On a cold cache that one reload failed 35
              // tests ("Vite unexpectedly reloaded a test"). Pre-bundling it removes the reload.
              // To find another late dep: DEBUG=vite:deps, look for "new dependencies found".
              optimizeDeps: { include: ['react/jsx-dev-runtime', 'react/jsx-runtime'] },
              test: {
                name: 'browser',
                // Ninebrains: the browser-mode default, made explicit so the contract is visible
                // and a root-level change cannot shrink it. Locator actions get the time left in
                // this budget. Under full-suite load a test can spend most of it before a click;
                // CI retries browser tests once and annotates every pass-on-retry, and the budget
                // is not raised to hide that.
                testTimeout: 15_000,
                browser: {
                  enabled: true,
                  provider: playwright(),
                  headless: true,
                  instances: [{ browser: 'chromium' }],
                },
                include: [
                  'src/renderer/tests/browser/**/*.test.{ts,tsx}',
                  'src/core/**/*.browser.test.{ts,tsx}',
                ],
              },
            },
          ]),
    ],
  },
});

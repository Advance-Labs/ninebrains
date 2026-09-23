// Lanes smoke test: add a project, open the Lanes view, add four lanes, check
// four terminals render, and capture screenshots at 1440×900, maximized, and the
// minimum window size. Run with `pnpm e2e` (builds first) or `pnpm e2e:run`.
// Kept out of CI (like the upstream browser test project) until it is stable.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchApp,
  repoRoot,
  setContentSize,
  setMinimumSize,
  stubDirectoryPicker,
} from './harness.mjs';

const SCREENSHOTS = join(repoRoot, 'docs/screenshots');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LONG = 90_000;

function step(message) {
  process.stdout.write(`• ${message}\n`);
}

async function addProject(app, page, repo) {
  await stubDirectoryPicker(app, repo);
  await page.getByText('Open project', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Project' });
  await dialog.waitFor({ timeout: LONG });
  const picker = dialog.getByText('Select a directory');
  if (await picker.isVisible()) await picker.click();
  await dialog.locator('button[data-variant="primary"]', { hasText: 'Create' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: LONG });
}

async function openLanes(page) {
  await page.keyboard.press(`${MOD}+K`);
  await page.keyboard.type('Open Lanes');
  await page
    .getByRole('option', { name: /Open Lanes/ })
    .first()
    .click();
  await page.getByTestId('lanes-grid').waitFor({ timeout: LONG });
}

async function dismissIntroIfShown(page) {
  const intro = page.getByTestId('lanes-empty-intro');
  if (await intro.isVisible().catch(() => false)) {
    await page.getByTestId('lanes-add-first').click();
  }
}

async function addLane(page, slot) {
  await dismissIntroIfShown(page);
  const cell = page.locator(`[data-testid="lane-cell"][data-slot="${slot}"]`);
  const add = cell.getByRole('button', { name: 'Add lane' });
  await add.waitFor({ timeout: LONG });
  await page.waitForFunction(
    (selector) => {
      const button = [...document.querySelectorAll(selector)].find(
        (b) => b.textContent === 'Add lane'
      );
      return button && !button.disabled;
    },
    `[data-testid="lane-cell"][data-slot="${slot}"] button`,
    { timeout: LONG }
  );
  await add.click();
}

async function main() {
  const { app, page, root, repo, fake } = await launchApp();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  step(`profile ${root}; fake claude ${fake}`);
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project');
    await addProject(app, page, repo);

    step('opening the Lanes view');
    await openLanes(page);

    for (const slot of [0, 1, 2, 3]) {
      step(`adding lane ${slot + 1}`);
      await addLane(page, slot);
    }

    step('waiting for four terminals');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lane-cell"] .xterm').length === 4,
      undefined,
      { timeout: LONG * 2 }
    );
    await page.waitForTimeout(1_500);

    mkdirSync(SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(SCREENSHOTS, 'lanes-grid-1440.png') });
    step('saved lanes-grid-1440.png');

    await page.locator('[data-testid="lane-cell"][data-slot="0"] .xterm').click();
    await page.keyboard.press(`${MOD}+Shift+Enter`);
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lane-cell"][data-dimmed="true"]').length === 3,
      undefined,
      { timeout: 10_000 }
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SCREENSHOTS, 'lanes-grid-maximized.png') });
    step('saved lanes-grid-maximized.png');
    await page.keyboard.press(`${MOD}+Shift+Enter`);

    const minimum = await setMinimumSize(app);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(SCREENSHOTS, 'lanes-grid-min.png') });
    step(`saved lanes-grid-min.png (${minimum.width}×${minimum.height})`);

    if (consoleErrors.length > 0) step(`renderer console errors:\n  ${consoleErrors.join('\n  ')}`);
    step('PASS');
  } catch (error) {
    const failure = join(root, 'failure.png');
    await page.screenshot({ path: failure }).catch(() => {});
    process.stderr.write(`FAIL: ${error instanceof Error ? error.stack : error}\n`);
    process.stderr.write(`failure screenshot: ${failure}\n`);
    if (consoleErrors.length > 0)
      process.stderr.write(`console errors:\n  ${consoleErrors.join('\n  ')}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

await main();

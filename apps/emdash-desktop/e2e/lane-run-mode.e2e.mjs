// Dogfood matrix P0: switching a lane between attended and unattended. Adds one lane, flips its
// run-mode control to unattended (through the real confirmation dialog), checks the warning
// badge, then flips it back. See docs/guide/unattended-runs.md#making-a-lane-unattended and
// src/core/features/brain/browser/lane-run-mode.tsx.
//
// Run: `pnpm run build` at the repo root first, then `node e2e/lane-run-mode.e2e.mjs`.
import { join } from 'node:path';
import { LONG, addLane, addProject, openLanes, step } from './brain-e2e.mjs';
import { closeApp, hangWatchdog, launchApp, setContentSize } from './harness.mjs';

const cell = (page, slot) => page.locator(`[data-testid="lane-cell"][data-slot="${slot}"]`);
const runModeButton = (page, slot) => cell(page, slot).getByTestId('lane-run-mode');

async function main() {
  const { app, page, root, repo } = await launchApp();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project and one lane');
    await addProject(app, page, repo);
    await openLanes(page);
    await addLane(page, 0);
    await cell(page, 0).locator('.xterm').waitFor({ timeout: LONG });

    step('lane starts attended');
    const button = runModeButton(page, 0);
    await button.waitFor({ timeout: LONG });
    if ((await button.getAttribute('data-mode')) !== 'attended')
      throw new Error('a new lane should start attended');

    step('switching to unattended asks first');
    await button.click();
    const dialog = page.getByRole('dialog', { name: "Run this lane's Brain jobs unattended?" });
    await dialog.waitFor({ timeout: LONG });
    await dialog.getByRole('button', { name: 'Run unattended' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: LONG });

    await page.waitForFunction(
      (slot) =>
        document
          .querySelector(`[data-testid="lane-cell"][data-slot="${slot}"] [data-testid="lane-run-mode"]`)
          ?.getAttribute('data-mode') === 'unattended',
      0,
      { timeout: LONG }
    );
    const badgeText = await runModeButton(page, 0).textContent();
    if (!badgeText?.includes('Unattended')) throw new Error(`expected an Unattended badge, got ${badgeText}`);
    step(`lane is unattended (badge: "${badgeText.trim()}")`);

    step('switching back to attended needs no confirmation');
    await runModeButton(page, 0).click();
    await page.waitForFunction(
      (slot) =>
        document
          .querySelector(`[data-testid="lane-cell"][data-slot="${slot}"] [data-testid="lane-run-mode"]`)
          ?.getAttribute('data-mode') === 'attended',
      0,
      { timeout: LONG }
    );
    step('lane is attended again');

    if (consoleErrors.length > 0) step(`renderer console errors:\n  ${consoleErrors.join('\n  ')}`);
    step('PASS');
  } catch (error) {
    const failure = join(root, 'failure.png');
    await page.screenshot({ path: failure }).catch(() => {});
    process.stderr.write(
      `FAIL: ${error instanceof Error ? error.stack : error}\nfailure screenshot: ${failure}\n`
    );
    if (consoleErrors.length > 0)
      process.stderr.write(`console errors:\n  ${consoleErrors.join('\n  ')}\n`);
    process.exitCode = 1;
  } finally {
    await closeApp(app);
  }
}

hangWatchdog(5 * 60_000);
await main();
process.exit(process.exitCode ?? 0);

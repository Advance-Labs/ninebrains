// Dogfood matrix P0: adding a lane from a pack role. Enables the coding pack (no secrets, no
// disclosure to confirm), then adds a lane with the pack's "Builder" role picked in the add-lane
// form. Proves the role reaches the real launch by reading the lane's actual `claude` argv off
// FAKE_AGENT_ARGV_LOG for `--append-system-prompt`, the flag Ninebrains adds for a role
// (src/core/features/brain/node/launch-config.ts). See docs/guide/packs.md#how-a-pack-reaches-a-lane.
//
// Run: `pnpm run build` at the repo root first, then `node e2e/lane-from-pack-role.e2e.mjs`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LONG, addProject, openLanes, runCommand, step, until } from './brain-e2e.mjs';
import { closeApp, hangWatchdog, launchApp, setContentSize } from './harness.mjs';

const ROLE_LABEL = 'Builder (Coding)';
const ROLE_PROMPT_PREFIX = 'You are a builder lane.';

async function enableCodingPack(page) {
  await runCommand(page, 'Open Settings');
  await page.getByRole('button', { name: 'Packs', exact: true }).click();
  // Every pack's toggle shares the label "Enabled for this project"; find the
  // one in the Coding pack's own section, named by its heading ("Coding Apache-2.0").
  const heading = page.getByRole('heading', { name: 'Coding Apache-2.0', level: 3 });
  await heading.waitFor({ timeout: LONG });
  const section = heading.locator('xpath=ancestor::section[1]');
  const toggle = section.getByRole('switch', { name: 'Enabled for this project' });
  await toggle.click();
  await until(
    'coding pack enabled',
    async () => (await toggle.getAttribute('aria-checked')) === 'true'
  );
  await page.keyboard.press('Escape');
}

async function addLaneWithRole(page, slot, roleLabel) {
  const cell = page.locator(`[data-testid="lane-cell"][data-slot="${slot}"]`);
  const roleSelect = cell.getByRole('combobox', { name: 'Role' });
  await roleSelect.waitFor({ timeout: LONG });
  await roleSelect.click();
  await page.getByRole('option', { name: roleLabel, exact: true }).click();
  await cell.getByRole('button', { name: 'Add lane' }).click();
}

async function main() {
  const { app, page, root, repo } = await launchApp();
  const argvLog = join(root, 'argv.log');
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project');
    await addProject(app, page, repo);

    step('Settings → Packs: enabling the coding pack');
    await enableCodingPack(page);

    step('opening Lanes and adding a lane with the Builder role');
    await openLanes(page);
    await addLaneWithRole(page, 0, ROLE_LABEL);

    step('waiting for the lane terminal');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="lane-cell"] .xterm').length === 1,
      undefined,
      { timeout: LONG * 2 }
    );

    step('reading the lane launch off FAKE_AGENT_ARGV_LOG');
    const launch = await until('a claude launch with --append-system-prompt', () => {
      let lines;
      try {
        lines = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean);
      } catch {
        return undefined; // Not written yet.
      }
      return lines
        .map((line) => JSON.parse(line))
        .find((entry) => entry.argv.some((arg) => arg.startsWith('--append-system-prompt=')));
    });
    const flag = launch.argv.find((arg) => arg.startsWith('--append-system-prompt='));
    const prompt = flag.slice('--append-system-prompt='.length);
    if (!prompt.startsWith(ROLE_PROMPT_PREFIX))
      throw new Error(`expected the builder role's prompt, got: ${prompt.slice(0, 80)}…`);
    step(`lane launched with the role's system prompt ("${ROLE_PROMPT_PREFIX}")`);

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

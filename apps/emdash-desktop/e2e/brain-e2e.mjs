// Shared steps for the e2e tests that drive the Brain: add the fixture project, open Lanes,
// add lanes, read each lane's launch config, and call the Brain endpoint the way brain-mcp does.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { stubDirectoryPicker } from './harness.mjs';

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
export const LONG = 90_000;

export const step = (message) => process.stdout.write(`• ${message}\n`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(label, check, ms = LONG) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

/** A brain-mcp-shaped call: Node client, no Origin/Sec-Fetch, exact Host. */
export function brainCall(url, token, op, args = {}) {
  const { port } = new URL(url);
  const body = JSON.stringify({ v: 1, op, args });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/brain/v1/call',
        method: 'POST',
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          const json = JSON.parse(text);
          if (!json.ok) reject(new Error(`${op}: ${json.error.code} ${json.error.message}`));
          else resolve(json.result);
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Every lane's and Brain's mcp.json under <userData>/ninebrains/lanes: URL, token, lane id. */
export function launchConfigs(userData) {
  const root = join(userData, 'ninebrains', 'lanes');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((dir) => {
    const file = join(root, dir, 'mcp.json');
    if (!existsSync(file)) return [];
    const env = JSON.parse(readFileSync(file, 'utf8')).mcpServers.brain.env;
    return [
      {
        dir,
        url: env.NINEBRAINS_BRAIN_URL,
        token: env.NINEBRAINS_TOKEN,
        laneId: env.NINEBRAINS_LANE_ID,
      },
    ];
  });
}

export async function addProject(app, page, repo) {
  await stubDirectoryPicker(app, repo);
  await page.getByText('Open project', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Project' });
  await dialog.waitFor({ timeout: LONG });
  const picker = dialog.getByText('Select a directory');
  if (await picker.isVisible()) await picker.click();
  await dialog.locator('button[data-variant="primary"]', { hasText: 'Create' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: LONG });
}

/** Runs a command palette entry by its title. */
export async function runCommand(page, title) {
  await page.keyboard.press(`${MOD}+K`);
  await page.keyboard.type(title);
  await page
    .getByRole('option', { name: new RegExp(title) })
    .first()
    .click();
}

export async function openLanes(page) {
  await runCommand(page, 'Open Lanes');
  await page.getByTestId('lanes-grid').waitFor({ timeout: LONG });
}

export async function addLane(page, slot) {
  const selector = `[data-testid="lane-cell"][data-slot="${slot}"] button`;
  await page.waitForFunction(
    (sel) =>
      [...document.querySelectorAll(sel)].some((b) => b.textContent === 'Add lane' && !b.disabled),
    selector,
    { timeout: LONG }
  );
  await page
    .locator(`[data-testid="lane-cell"][data-slot="${slot}"]`)
    .getByRole('button', { name: 'Add lane' })
    .click();
}

/** Settings → Gates → Tests: the project's test command, through the real settings page. */
export async function setTestCommand(page, command) {
  await runCommand(page, 'Open Settings');
  await page.getByRole('button', { name: 'Gates', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Test command' });
  await input.waitFor({ timeout: LONG });
  await until('test command input enabled', () => input.isEnabled());
  await input.fill(command);
  const save = page.getByRole('button', { name: 'Save test command' });
  await save.click();
  await until('test command saved', async () => !(await save.isEnabled()));
}

/**
 * Attended lanes never auto-approve (the launch refuses it), so every Brain tool call and file
 * write asks in the lane's terminal. This answers those prompts the way a user would: "1", Enter,
 * only while a lane's last visible lines are the fake agent's "1. Yes / 2. No" menu.
 * Returns a function that stops it.
 */
export function approveLanePrompts(page, { intervalMs = 400, cooldownMs = 1_500 } = {}) {
  const answeredAt = new Map();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const waiting = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="lane-cell"]')].flatMap((cell) => {
          const rows = [...cell.querySelectorAll('.xterm-rows > div')]
            .map((row) => row.textContent.trim())
            .filter(Boolean);
          const [yes, no] = rows.slice(-2);
          return yes?.includes('1. Yes') && no?.includes('2. No') ? [cell.dataset.slot] : [];
        })
      );
      for (const slot of waiting) {
        if (Date.now() - (answeredAt.get(slot) ?? 0) < cooldownMs) continue;
        answeredAt.set(slot, Date.now());
        await page.locator(`[data-testid="lane-cell"][data-slot="${slot}"] .xterm`).click();
        await page.keyboard.press('1');
        await page.keyboard.press('Enter');
      }
    } catch {
      // The page is closing or re-rendering; the next tick tries again.
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

/** Opens the Brain drawer, starts a Brain session and returns its launch config. */
export async function startBrain(page, userData) {
  await page.getByTestId('brain-drawer-toggle').click();
  // The drawer's resizable panel carries the same test id, so find the drawer by its role.
  const drawer = page.getByRole('complementary', { name: 'Brain' });
  await drawer.waitFor({ timeout: LONG });
  await drawer.getByRole('button', { name: 'Start Brain' }).click();
  const brain = await until('brain launch config', () =>
    launchConfigs(userData).find((c) => c.dir.startsWith('brain-'))
  );
  const whoami = await brainCall(brain.url, brain.token, 'whoami');
  if (whoami.role !== 'brain') throw new Error(`brain token has role ${whoami.role}`);
  return brain;
}

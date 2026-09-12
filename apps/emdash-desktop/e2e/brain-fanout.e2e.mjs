import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
// Phase 2 exit demo: the Brain fans a 5-job brief with 2 dependencies out to
// 3 lanes, waits on the dependencies, lanes report back, and the done log is
// complete. Every lane runs tooling/fake-agent over the REAL brain-mcp shim and
// the REAL Brain endpoint; the test plays the Brain model by posting the brief
// with the Brain session's own minted token. Also: SEC-05 from an in-app
// offscreen BrowserWindow, and the brain-drawer screenshots.
// Run with `pnpm e2e:brain` (builds first). Kept out of CI like lanes-smoke.
import http from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
const LANES = [0, 1, 2];

// Each pasted job: say something, report it with the id taken from the prompt, end the turn.
const ROUND = [
  { say: 'On it: {{prompt:^Brain job [^:]+: (.*)$}}' },
  {
    callTool: {
      server: 'brain',
      tool: 'complete_job',
      args: {
        jobId: '{{prompt:jobId "([A-Za-z0-9_-]+)"}}',
        summary: 'fake lane finished {{prompt:^Brain job [^:]+: (.*)$}} and checked it',
      },
    },
  },
  { say: 'Reported.' },
  { waitForInput: true },
];
const LANE_SCRIPT = Array.from({ length: 6 }, () => ROUND).flat();

const step = (message) => process.stdout.write(`• ${message}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(label, check, ms = LONG) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

/** A brain-mcp-shaped call: Node client, no Origin/Sec-Fetch, exact Host. */
function brainCall(url, token, op, args = {}) {
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

function launchConfigs(userData) {
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

async function addLane(page, slot) {
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

/** SEC-05: a page inside the app (offscreen, own partition) tries the endpoint with a real token. */
async function browserAttack(app, url, token, laneId) {
  return app.evaluate(
    async ({ BrowserWindow }, target) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, partition: 'e2e-sec05', sandbox: true },
      });
      await win.loadURL('data:text/html,<title>attacker</title>');
      const outcome = await win.webContents.executeJavaScript(`(async () => {
        const body = JSON.stringify({ v: 1, op: 'send_message', args: { to: { kind: 'lane', id: ${JSON.stringify(target.laneId)} }, body: 'from a web page' } });
        const results = [];
        try {
          const r = await fetch(${JSON.stringify(target.url)} + '/brain/v1/call', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body });
          results.push('no-cors:' + r.type + ':' + r.status);
        } catch (e) { results.push('no-cors:error'); }
        try {
          const r = await fetch(${JSON.stringify(target.url)} + '/brain/v1/call', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(target.token)} }, body });
          results.push('json:' + r.status);
        } catch (e) { results.push('json:blocked'); }
        return results;
      })()`);
      win.destroy();
      return outcome;
    },
    { url, token, laneId }
  );
}

async function main() {
  const { app, page, root, repo } = await launchApp({
    env: { FAKE_AGENT_SCRIPT: JSON.stringify(LANE_SCRIPT) },
  });
  const userData = join(root, 'user-data');
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  let jobs = {};
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);
    step('adding the fixture project and opening Lanes');
    await addProject(app, page, repo);
    await openLanes(page);
    for (const slot of LANES) await addLane(page, slot);
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="lane-cell"] .xterm').length === n,
      LANES.length,
      { timeout: LONG * 2 }
    );
    await until(
      'lane launch configs',
      () =>
        launchConfigs(userData).filter((c) => !c.dir.startsWith('brain-')).length === LANES.length
    );
    step('3 lanes up, each with its own 0600 mcp.json and token');

    step('opening the Brain drawer and starting a Brain session');
    await page.getByTestId('brain-drawer-toggle').click();
    await page.getByTestId('brain-drawer').waitFor({ timeout: LONG });
    await page.getByTestId('brain-drawer').getByRole('button', { name: 'Start Brain' }).click();
    const brain = await until('brain launch config', () =>
      launchConfigs(userData).find((c) => c.dir.startsWith('brain-'))
    );
    const whoami = await brainCall(brain.url, brain.token, 'whoami');
    if (whoami.role !== 'brain') throw new Error(`brain token has role ${whoami.role}`);

    step('posting the brief: 5 jobs, C needs A, E needs C');
    const create = (title, dependsOn = []) =>
      brainCall(brain.url, brain.token, 'create_job', { title, body: `Do ${title}.`, dependsOn });
    const A = await create('A scaffold the module');
    const B = await create('B write the README');
    const C = await create('C implement on the scaffold', [A.id]);
    const D = await create('D add a changelog entry');
    const E = await create('E test the implementation', [C.id]);
    jobs = { A, B, C, D, E };
    const names = Object.fromEntries(Object.entries(jobs).map(([k, j]) => [j.id, k]));

    const firstTaken = {};
    const firstDone = {};
    const lanesUsed = new Set();
    const started = Date.now();
    await until(
      'all five jobs done',
      async () => {
        const listed = await brainCall(brain.url, brain.token, 'list_jobs', { limit: 50 });
        const list = Array.isArray(listed) ? listed : listed.jobs;
        const now = Date.now() - started;
        for (const job of list) {
          if (!names[job.id]) continue;
          if (['claimed', 'running', 'verifying', 'done'].includes(job.state))
            firstTaken[job.id] ??= now;
          if (job.state === 'done') firstDone[job.id] ??= now;
          if (job.laneId) lanesUsed.add(job.laneId);
        }
        return Object.keys(firstDone).length === 5;
      },
      180_000
    );
    for (const [key, job] of Object.entries(jobs)) {
      step(`  ${key}: taken at ${firstTaken[job.id]} ms, done at ${firstDone[job.id]} ms`);
    }
    if (firstTaken[C.id] < firstDone[A.id]) throw new Error('C was dispatched before A was done');
    if (firstTaken[E.id] < firstDone[C.id]) throw new Error('E was dispatched before C was done');
    if (lanesUsed.size < 2) throw new Error(`fan-out used ${lanesUsed.size} lane(s)`);
    step(`all 5 done in dependency order across ${lanesUsed.size} lanes`);

    step('SEC-05: an in-app web page calls the endpoint with a real lane token');
    const lane = launchConfigs(userData).find((c) => !c.dir.startsWith('brain-'));
    const address = { kind: 'lane', id: lane.laneId };
    await brainCall(brain.url, brain.token, 'read_inbox', { address, limit: 200 });
    const attack = await browserAttack(app, lane.url, lane.token, lane.laneId);
    const leaked = await brainCall(brain.url, brain.token, 'read_inbox', { address, limit: 200 });
    if (leaked.length > 0)
      throw new Error(`browser request reached the Brain: ${JSON.stringify(leaked)}`);
    step(`  rejected (${attack.join(', ')}); inbox unchanged`);

    step('screenshots: drawer open, lane 1 side panel on the done log');
    const cell = page.locator('[data-testid="lane-cell"][data-slot="0"]');
    await cell.getByRole('button', { name: 'Jobs, done and notes' }).click();
    await cell.getByRole('tab', { name: 'Done' }).click();
    await page.waitForTimeout(1_500);
    mkdirSync(SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(SCREENSHOTS, 'brain-drawer-1440.png') });
    const minimum = await setMinimumSize(app);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(SCREENSHOTS, 'brain-drawer-min.png') });
    step(
      `saved brain-drawer-1440.png and brain-drawer-min.png (${minimum.width}×${minimum.height})`
    );
    if (consoleErrors.length > 0) step(`renderer console errors:\n  ${consoleErrors.join('\n  ')}`);
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
    await app.close();
  }
  if (process.exitCode) return;

  step('done log from the Brain DB after shutdown');
  const db = new DatabaseSync(join(userData, 'ninebrains-brain.db'), { readOnly: true });
  const done = db.prepare('SELECT * FROM done_log').all();
  const unverified = db.prepare("SELECT * FROM notes WHERE body LIKE '[gates] unverified:%'").all();
  db.close();
  const doneIds = new Set(done.map((row) => row.job_id));
  const missing = Object.entries(jobs).filter(([, job]) => !doneIds.has(job.id));
  if (missing.length > 0 || done.length !== 5) {
    process.stderr.write(
      `FAIL: done log has ${done.length} rows; missing ${missing.map(([k]) => k)}\n`
    );
    process.exitCode = 1;
    return;
  }
  step(`done log complete: 5 rows, ${unverified.length} marked unverified (no gate runner wired)`);
  step('PASS');
}

await main();

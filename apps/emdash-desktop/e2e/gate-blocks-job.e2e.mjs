// Dogfood matrix P0 gap: three gate failures block a job, with no fourth attempt, and the Brain
// drawer shows it. MAX_ATTEMPTS is 3 (packages/brain-core/src/state-machine.ts); the third failed
// attempt transitions the job straight to `blocked` (brain-core/src/brain/jobs.ts) instead of
// giving it a fourth try. This reuses self-heal.e2e.mjs's approach for making a gate fail on
// purpose (a UI job whose page always throws, so the screenshot gate's console-error check never
// passes) — the difference is the lane never fixes it, so all three attempts fail and the job
// blocks instead of eventually passing.
//
// Run: `pnpm run build` at the repo root first, then `node e2e/gate-blocks-job.e2e.mjs`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LONG,
  addLane,
  addProject,
  approveLanePrompts,
  brainCall,
  launchConfigs,
  openLanes,
  setTestCommand,
  startBrain,
  step,
  until,
} from './brain-e2e.mjs';
import { closeApp, hangWatchdog, launchApp, setContentSize } from './harness.mjs';

const TEST_COMMAND = 'node hero.test.mjs';
const JOB_ID = '{{prompt:jobId "([A-Za-z0-9_-]+)"}}';

// Always broken: no fix step, ever. Every attempt's screenshot gate sees the same console error.
const HEAD = '<!doctype html><title>Hero</title><link rel="icon" href="data:,">';
const BROKEN = `${HEAD}<main id="app"></main>
<script>const hero = undefined; document.getElementById('app').textContent = hero.title;</script>`;

const FIXTURE = {
  'index.html': BROKEN,
  '.gitignore': '.preview-url\n',
  '.emdash.json': `${JSON.stringify({ scripts: { run: 'node serve.mjs' } }, null, 2)}\n`,
  'serve.mjs': `import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/index.html') return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync('index.html'));
});
server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  writeFileSync('.preview-url', url);
  console.log('Hero preview ready at ' + url);
});
`,
  'hero.test.mjs': `import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
if (!html.includes('id="app"')) throw new Error('index.html lost its #app root');
console.log('ok: index.html keeps its #app root');
`,
};

// Reports the job, then waits; on the nudge, reports it again unchanged. Three rounds is enough
// to reach MAX_ATTEMPTS; a fourth round would prove a bug (it should never be dispatched again).
const ROUND = [
  { say: 'Building {{prompt:^Brain job [^:]+: (.*)$}}' },
  {
    callTool: {
      server: 'brain',
      tool: 'complete_job',
      args: { jobId: JOB_ID, summary: 'Still broken, reporting anyway' },
    },
  },
  { waitForInput: true },
];
const LANE_SCRIPT = Array.from({ length: 4 }, () => ROUND).flat();

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function seedFixture(repo) {
  for (const [file, content] of Object.entries(FIXTURE)) writeFileSync(join(repo, file), content);
  git(repo, 'add', ...Object.keys(FIXTURE));
  git(repo, 'commit', '-m', 'a hero that never gets fixed');
}

function laneWorktrees(repo) {
  return git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .flatMap((line) => (line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []))
    .filter((path) => path !== repo);
}

async function autoRunRunScript(page) {
  await page
    .getByRole('tablist', { name: 'Project sections' })
    .getByRole('tab', { name: 'Settings' })
    .click();
  const toggle = page
    .locator('div.justify-between', { hasText: 'Auto-run on task creation' })
    .getByRole('switch', { checked: false })
    .first();
  await toggle.waitFor({ timeout: LONG });
  await toggle.click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor({ timeout: LONG });
}

async function waitForLanePreview(repo) {
  return until('the lane preview server', async () => {
    const marker = laneWorktrees(repo)
      .map((worktree) => join(worktree, '.preview-url'))
      .find((file) => existsSync(file));
    if (!marker) return false;
    const url = readFileSync(marker, 'utf8').trim();
    const response = await fetch(url).catch(() => null);
    return response?.ok ? url : false;
  });
}

/** Polls until `predicate(job)` holds; prints the lane inbox on a timeout. */
async function waitForJob(brain, jobId, predicate, label) {
  let last;
  try {
    return await until(
      label,
      async () => {
        const jobs = await brainCall(brain.url, brain.token, 'list_jobs', { limit: 50 });
        last = jobs.find((j) => j.id === jobId);
        return last && predicate(last) ? last : false;
      },
      480_000
    );
  } catch (error) {
    step(`job at timeout: ${JSON.stringify(last)}`);
    throw error;
  }
}

/** Types the same nudge self-heal.e2e.mjs uses; each pass keeps `jobId "..."` for interpolation. */
async function resumeAgent(page, jobId) {
  await page.locator('[data-testid="lane-cell"][data-slot="0"] .xterm').click();
  await page.keyboard.type(`Gate feedback for jobId "${jobId}" is in your inbox. Try again.`);
  await page.keyboard.press('Enter');
}

async function main() {
  const { app, page, root, repo } = await launchApp({
    env: { FAKE_AGENT_SCRIPT: JSON.stringify(LANE_SCRIPT) },
  });
  const userData = join(root, 'user-data');
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  seedFixture(repo);
  let jobId;
  let stopApproving = () => {};
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project; Run auto-starts its dev server in each new worktree');
    await addProject(app, page, repo);
    await autoRunRunScript(page);
    step(`Settings → Gates: test command \`${TEST_COMMAND}\``);
    await setTestCommand(page, TEST_COMMAND);

    step('opening Lanes, adding one lane, starting a Brain session');
    await openLanes(page);
    await addLane(page, 0);
    await until('lane launch config', () =>
      launchConfigs(userData).some((c) => !c.dir.startsWith('brain-'))
    );
    stopApproving = approveLanePrompts(page);
    await waitForLanePreview(repo);
    step('the lane run script is serving the broken page');
    const brain = await startBrain(page, userData);

    const job = await brainCall(brain.url, brain.token, 'create_job', {
      title: 'Hero section, never fixed',
      body: 'Render the hero in index.html. The preview must load with no console errors.',
      gateKind: 'ui',
    });
    jobId = job.id;
    step(`created UI job ${jobId}`);

    // startBrain already opened the drawer (it clicks the toggle itself); a second click would
    // close it.
    const drawer = page.getByRole('complementary', { name: 'Brain' });
    await drawer.waitFor({ timeout: LONG });

    for (const attempt of [1, 2]) {
      await waitForJob(
        brain,
        jobId,
        (j) => j.state === 'running' && j.attempts === attempt,
        `attempt ${attempt} failing and sending the job back`
      );
      step(`attempt ${attempt} failed as expected; nudging the lane to try again`);
      await resumeAgent(page, jobId);
    }

    const blocked = await waitForJob(
      brain,
      jobId,
      (j) => j.state === 'blocked',
      'the third failure blocking the job'
    );
    step(`job blocked after ${blocked.attempts} attempts: ${blocked.reason}`);
    if (blocked.attempts !== 3) {
      throw new Error(`expected exactly 3 attempts at block time, got ${blocked.attempts}`);
    }

    step('no fourth attempt: the job stays blocked for a few seconds with dispatch still running');
    await new Promise((r) => setTimeout(r, 5_000));
    const stillBlocked = await brainCall(brain.url, brain.token, 'list_jobs', { limit: 50 }).then(
      (jobs) => jobs.find((j) => j.id === jobId)
    );
    if (stillBlocked.state !== 'blocked' || stillBlocked.attempts !== 3) {
      throw new Error(`job moved after blocking: ${JSON.stringify(stillBlocked)}`);
    }
    step('confirmed: no fourth attempt was made');

    step('checking the Brain drawer shows the block: a "1 blocked" badge');
    const badge = drawer.getByText(/^1 blocked$/);
    await badge.waitFor({ timeout: LONG });
    step('confirmed: the drawer\'s job-count row reads "1 blocked"');

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
    stopApproving();
    await closeApp(app);
  }
  if (process.exitCode || !jobId) return;

  step('verifying the stored job: blocked, 3 attempts, never verified');
  const db = new DatabaseSync(join(userData, 'ninebrains-brain.db'), { readOnly: true });
  const row = db.prepare('SELECT state, attempts, reason FROM jobs WHERE id = ?').get(jobId);
  db.close();
  if (row.state !== 'blocked' || row.attempts !== 3) {
    process.stderr.write(`FAIL: unexpected stored job: ${JSON.stringify(row)}\n`);
    process.exitCode = 1;
    return;
  }
  step(`stored job: ${row.state} after ${row.attempts} attempts (${row.reason})`);
  process.stdout.write(
    'PASS gate-blocks-job e2e: three gate failures blocked the job, with no fourth attempt\n'
  );
}

hangWatchdog(15 * 60_000);
await main();
process.exit(process.exitCode ?? 0);

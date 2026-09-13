// Phase 4 exit criterion, end to end: a deliberately broken UI job fails the screenshot gate,
// the feedback reaches the lane's inbox, the (fake) agent fixes the page and calls complete_job
// again, and attempt 2 passes with three screenshots in the evidence dir.
//
// Everything goes through public paths, never a test hook in the app:
// - The fixture repo commits `.emdash.json` with a `run` script that serves the page on a leased
//   port and prints its URL. The test turns on "Auto-run on task creation" for Run in the
//   project's settings, so the lane's worktree starts it; Emdash's dev-server detection registers
//   the URL as the lane's preview, which is what the gate runner screenshots.
// - The test command is set in Settings → Gates. The job is a UI job because the Brain declares
//   `gateKind: "ui"` in create_job (SEC-08 allows agents code or ui).
// - The lane runs tooling/fake-agent over the real brain-mcp shim. Nothing re-prompts an idle
//   agent when a gate sends its job back, so the test types the nudge into the lane's terminal,
//   as a user would. The visual reviewer is the fake too (harness.mjs gives `claude -p` an
//   approving script).
//
// Run: `pnpm run build` at the repo root first (it builds the workspace packages the app bundles;
// the app-only build fails on a fresh worktree), then `node e2e/self-heal.e2e.mjs`. Uses the fake
// agent only, never a real CLI. Kept out of CI like the lanes smoke test. The same loop is proven
// at service level in CI: src/core/features/gates/node/runner/self-heal.test.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
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

const here = dirname(fileURLToPath(import.meta.url));
const WIRING = join(here, '../src/main/bootstrap/boot/ninebrains/create-ninebrains-services.ts');
const TEST_COMMAND = 'node hero.test.mjs';
const JOB_ID = '{{prompt:jobId "([A-Za-z0-9_-]+)"}}';

// A favicon link keeps the browser from requesting /favicon.ico, which would count as a failed
// same-origin request.
const HEAD = '<!doctype html><title>Hero</title><link rel="icon" href="data:,">';
const BROKEN = `${HEAD}<main id="app"></main>
<script>const hero = undefined; document.getElementById('app').textContent = hero.title;</script>`;
const FIXED = `${HEAD}<main id="app"><h1>Renovations, on schedule</h1></main>`;

const FIXTURE = {
  'index.html': BROKEN,
  '.gitignore': '.preview-url\n',
  '.emdash.json': `${JSON.stringify({ scripts: { run: 'node serve.mjs' } }, null, 2)}\n`,
  // The dev server: a leased port, the URL on stdout for Emdash's detection, and a marker file
  // so the test knows when it is up.
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

/** Complete, wait for the gate's feedback, fix the page, complete again. */
const LANE_SCRIPT = [
  { say: 'Building {{prompt:^Brain job [^:]+: (.*)$}}' },
  {
    callTool: {
      server: 'brain',
      tool: 'complete_job',
      args: { jobId: JOB_ID, summary: 'Hero built' },
    },
  },
  { waitForInput: true },
  { writeFile: { path: 'index.html', content: FIXED } },
  {
    callTool: {
      server: 'brain',
      tool: 'complete_job',
      args: { jobId: JOB_ID, summary: 'Fixed the TypeError: the hero title is static now' },
    },
  },
  { say: 'Reported.' },
  { waitForInput: true },
];

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

/** Commits the broken page, its dev server and its test into the harness's fixture repo. */
function seedFixture(repo) {
  for (const [file, content] of Object.entries(FIXTURE)) writeFileSync(join(repo, file), content);
  git(repo, 'add', ...Object.keys(FIXTURE));
  git(repo, 'commit', '-m', 'broken hero, its dev server and its test');
}

/** Lane worktrees are `git worktree`s of the fixture repo. */
function laneWorktrees(repo) {
  return git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .flatMap((line) => (line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []))
    .filter((path) => path !== repo);
}

/** Turns on "Auto-run on task creation" for the Run script in the project's settings. */
async function autoRunRunScript(page) {
  await page
    .getByRole('tablist', { name: 'Project sections' })
    .getByRole('tab', { name: 'Settings' })
    .click();
  // Setup's toggle defaults on and Run's off, so the one that is off is Run's.
  const toggle = page
    .locator('div.justify-between', { hasText: 'Auto-run on task creation' })
    .getByRole('switch', { checked: false })
    .first();
  await toggle.waitFor({ timeout: LONG });
  await toggle.click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor({ timeout: LONG });
}

/** The five steps the loop needs, all through the Brain's wire contract or the UI. */
const hooks = {
  /** Creates a UI job with the Brain session's token; the dispatcher hands it to the lane. */
  async createUiJob(ctx, { title, body }) {
    const job = await brainCall(ctx.brain.url, ctx.brain.token, 'create_job', {
      title,
      body,
      gateKind: 'ui',
    });
    return { jobId: job.id };
  },
  /** Waits for the lane's run script to serve the page it will be screenshotted at. */
  async waitForLanePreview(ctx) {
    return until('the lane preview server', async () => {
      const marker = laneWorktrees(ctx.repo)
        .map((worktree) => join(worktree, '.preview-url'))
        .find((file) => existsSync(file));
      if (!marker) return false;
      const url = readFileSync(marker, 'utf8').trim();
      const response = await fetch(url).catch(() => null);
      return response?.ok ? { url, worktreePath: dirname(marker) } : false;
    });
  },
  /**
   * Polls the job until `predicate(job)` holds and returns it. A verification can take minutes
   * (tests, then three captures that each may wait out a load timeout). On a timeout the lane's
   * inbox is printed, since the gate's feedback says what went wrong.
   */
  async waitForJob(ctx, jobId, predicate, label) {
    let last;
    try {
      return await until(
        label,
        async () => {
          const jobs = await brainCall(ctx.brain.url, ctx.brain.token, 'list_jobs', { limit: 50 });
          last = jobs.find((j) => j.id === jobId);
          return last && predicate(last) ? last : false;
        },
        480_000
      );
    } catch (error) {
      const inbox = last?.laneId ? await hooks.readLaneInbox(ctx, last.laneId).catch(() => []) : [];
      step(`job at timeout: ${JSON.stringify(last)}`);
      for (const message of inbox) step(`lane inbox: ${message.body.slice(0, 1_500)}`);
      throw error;
    }
  },
  /** The lane's inbox, read with the Brain's token. */
  async readLaneInbox(ctx, laneId) {
    return brainCall(ctx.brain.url, ctx.brain.token, 'read_inbox', {
      address: { kind: 'lane', id: laneId },
      limit: 50,
    });
  },
  /** Types a nudge into the lane's terminal, so the fake agent runs its next steps. */
  async resumeAgent(ctx, jobId) {
    await ctx.page.locator('[data-testid="lane-cell"][data-slot="0"] .xterm').click();
    await ctx.page.keyboard.type(`Gate feedback for jobId "${jobId}" is in your inbox. Fix it.`);
    await ctx.page.keyboard.press('Enter');
  },
  implemented: true,
};

function skipReason() {
  if (!existsSync(WIRING)) {
    return 'the Brain composition root (create-ninebrains-services.ts, w5/brain-wiring) is not on this branch, so no job can reach verifying';
  }
  if (!readFileSync(WIRING, 'utf8').includes('createGatesServices')) {
    return 'the composition root does not construct createGatesServices yet (features/gates/README.md, "Wiring")';
  }
  if (!readFileSync(join(here, 'harness.mjs'), 'utf8').includes('--use-mock-keychain')) {
    return 'e2e/harness.mjs does not pass --use-mock-keychain yet, so a launch would prompt for the Keychain';
  }
  if (!hooks.implemented) return 'the Brain hooks in this file are not implemented yet';
  return null;
}

/** The job's stored verdict, read from the Brain DB once the app has closed. */
function storedJob(userData, jobId) {
  const db = new DatabaseSync(join(userData, 'ninebrains-brain.db'), { readOnly: true });
  const row = db
    .prepare('SELECT state, attempts, gate_spec, result FROM jobs WHERE id = ?')
    .get(jobId);
  db.close();
  return { ...row, gateSpec: JSON.parse(row.gate_spec), result: JSON.parse(row.result) };
}

async function main() {
  const reason = skipReason();
  if (reason) {
    process.stdout.write(`SKIP self-heal e2e: ${reason}\n`);
    return;
  }
  const { app, page, root, repo } = await launchApp({
    env: { FAKE_AGENT_SCRIPT: JSON.stringify(LANE_SCRIPT) },
  });
  const userData = join(root, 'user-data');
  const ctx = { page, repo, brain: null };
  let jobId;
  let stopApproving = () => {};
  step(`profile ${root}`);
  seedFixture(repo);
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
    const preview = await hooks.waitForLanePreview(ctx);
    step(`the lane's run script serves ${preview.url} (detected as its preview)`);
    ctx.brain = await startBrain(page, userData);

    ({ jobId } = await hooks.createUiJob(ctx, {
      title: 'Hero section',
      body: 'Render the hero in index.html. The preview must load with no console errors.',
    }));
    step(`created UI job ${jobId}; attempt 1 ships the broken page`);
    const retried = await hooks.waitForJob(
      ctx,
      jobId,
      (job) => job.state === 'running' && job.attempts === 1,
      'the screenshot gate sending attempt 1 back'
    );
    const inbox = await hooks.readLaneInbox(ctx, retried.laneId);
    const feedback = inbox.find((message) => message.body.includes('console error'));
    if (!feedback) {
      throw new Error(`the gate feedback did not reach the lane inbox: ${JSON.stringify(inbox)}`);
    }
    step(`lane inbox: ${feedback.body.split('\n').find((l) => l.includes('console error'))}`);

    await hooks.resumeAgent(ctx, jobId);
    await hooks.waitForJob(ctx, jobId, (job) => job.state === 'done', 'attempt 2 passing');
    step('attempt 2 passed its gates');
  } catch (error) {
    const failure = join(root, 'failure.png');
    await page.screenshot({ path: failure }).catch(() => {});
    process.stderr.write(
      `FAIL: ${error instanceof Error ? error.stack : error}\nfailure screenshot: ${failure}\n`
    );
    process.exitCode = 1;
  } finally {
    stopApproving();
    await closeApp(app);
  }
  if (process.exitCode) return;

  const done = storedJob(userData, jobId);
  const verification = done.result?.verification;
  if (
    !done.gateSpec?.gates?.includes('screenshot') ||
    !verification?.verified ||
    verification.attempt !== 2
  ) {
    process.stderr.write(
      `FAIL: expected a verified UI job on attempt 2, got ${JSON.stringify(done)}\n`
    );
    process.exitCode = 1;
    return;
  }
  const evidence = join(userData, 'ninebrains', 'evidence', jobId, '2');
  const shots = readdirSync(evidence).filter((file) => file.startsWith('screenshot-'));
  if (shots.length !== 3) {
    process.stderr.write(`FAIL: expected 3 screenshots, found ${shots.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  step(`gates ${done.gateSpec.gates.join(', ')}; screenshots ${shots.sort().join(', ')}`);
  process.stdout.write(`PASS self-heal e2e: attempt 2 verified, evidence in ${evidence}\n`);
}

hangWatchdog(30 * 60_000);
main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  }
);

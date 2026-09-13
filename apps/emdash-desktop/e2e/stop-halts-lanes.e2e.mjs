// Dogfood matrix P0: the global STOP switch. One lane holds a job that never finishes (the fake
// agent says something and then waits forever instead of completing it). STOP must: latch
// dispatch immediately, requeue the held job back to ready, and stop that lane's agent (it shows
// "Agent stopped" until you restart it by hand). Clear STOP lifts the latch but the job stays
// queued until the lane is restarted; only then does dispatch actually resume. See
// docs/guide/unattended-runs.md#the-stop-switch and src/core/features/brain/node/stop.ts.
//
// Run: `pnpm run build` at the repo root first, then `node e2e/stop-halts-lanes.e2e.mjs`.
import { join } from 'node:path';
import {
  LONG,
  addLane,
  addProject,
  approveLanePrompts,
  brainCall,
  launchConfigs,
  openLanes,
  setTestCommand,
  sleep,
  startBrain,
  step,
  until,
} from './brain-e2e.mjs';
import { closeApp, hangWatchdog, launchApp, setContentSize } from './harness.mjs';

const TEST_COMMAND = 'test -f README.md';
// Reports the job, then sits in an interactive turn forever: this lane never frees up on its own.
const STUCK_LANE_SCRIPT = [{ say: 'On it: {{prompt}}' }, { waitForInput: true }];

async function jobState(brain, jobId) {
  const list = await brainCall(brain.url, brain.token, 'list_jobs', { limit: 50 });
  return (Array.isArray(list) ? list : list.jobs).find((j) => j.id === jobId)?.state;
}

async function main() {
  const { app, page, root, repo } = await launchApp({
    env: { FAKE_AGENT_SCRIPT: JSON.stringify(STUCK_LANE_SCRIPT) },
  });
  const userData = join(root, 'user-data');
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  let stopApproving = () => {};
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project, a test command and one lane');
    await addProject(app, page, repo);
    await setTestCommand(page, TEST_COMMAND);
    await openLanes(page);
    await addLane(page, 0);
    await page.locator('[data-testid="lane-cell"][data-slot="0"] .xterm').waitFor({ timeout: LONG });
    await until(
      'the lane launch config',
      () => launchConfigs(userData).filter((c) => !c.dir.startsWith('brain-')).length === 1
    );
    stopApproving = approveLanePrompts(page);

    step('starting the Brain and posting a job that never completes');
    const brain = await startBrain(page, userData);
    const jobA = await brainCall(brain.url, brain.token, 'create_job', {
      title: 'A hang around forever',
      body: 'Say something and then wait; never call complete_job.',
    });
    await until('job A claimed by the lane', async () =>
      ['claimed', 'running'].includes(await jobState(brain, jobA.id))
    );
    step('job A is running in the lane');

    step('clicking STOP');
    await page.getByTestId('brain-stop').click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="brain-stop"]');
        return el?.textContent === 'Stopped' && el.disabled;
      },
      undefined,
      { timeout: LONG }
    );
    step('STOP button reads "Stopped" and is disabled');

    step('the lane holding job A should be stopped, and job A requeued to ready');
    await page.getByText('Agent stopped').waitFor({ timeout: LONG });
    await until('job A back to ready', async () => (await jobState(brain, jobA.id)) === 'ready');
    step('confirmed: the lane shows "Agent stopped" and job A is ready again');

    step('posting job B while STOP is latched');
    const jobB = await brainCall(brain.url, brain.token, 'create_job', {
      title: 'B should not dispatch while stopped',
      body: 'Only runs after Clear STOP and the lane is restarted.',
    });
    await sleep(3_000);
    const [stateA, stateB] = await Promise.all([jobState(brain, jobA.id), jobState(brain, jobB.id)]);
    if (stateA !== 'ready' || stateB !== 'ready')
      throw new Error(`both jobs should stay ready while STOP is latched, got A=${stateA} B=${stateB}`);
    step('confirmed: both jobs stayed ready, dispatch is latched');

    step('clicking Clear STOP');
    await page.getByRole('button', { name: 'Clear STOP' }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="brain-stop"]');
        return el?.textContent === 'STOP' && !el.disabled;
      },
      undefined,
      { timeout: LONG }
    );
    step('STOP button reads "STOP" again and is enabled');

    step('a stopped lane stays stopped: dispatch has nothing to paste into');
    await sleep(2_000);
    const [afterClearA, afterClearB] = await Promise.all([
      jobState(brain, jobA.id),
      jobState(brain, jobB.id),
    ]);
    if (afterClearA !== 'ready' || afterClearB !== 'ready')
      throw new Error(
        `expected both jobs still ready right after Clear STOP, got A=${afterClearA} B=${afterClearB}`
      );

    step('restarting the lane by hand, as the empty state asks');
    // The header also carries an icon-only "Start agent" control; target the empty state's own
    // labeled button by its visible text instead of role+name, which matches both.
    const stoppedCell = page.locator('[data-testid="lane-cell"]', { hasText: 'Agent stopped' });
    await stoppedCell.getByText('Start agent', { exact: true }).click();

    step('dispatch resumes: a job reaches the restarted lane');
    await until(
      'a job claimed after the lane restarts',
      async () => {
        const [a, b] = await Promise.all([jobState(brain, jobA.id), jobState(brain, jobB.id)]);
        return ['claimed', 'running'].includes(a) || ['claimed', 'running'].includes(b);
      },
      LONG
    );
    step('STOP → Clear STOP → restart round-trip works end to end');

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
}

hangWatchdog(10 * 60_000);
await main();
process.exit(process.exitCode ?? 0);

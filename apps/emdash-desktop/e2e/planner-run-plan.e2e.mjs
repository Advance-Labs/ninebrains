// Dogfood matrix P0 gap: Planner "Run plan" -> jobs in the Brain (docs/testing/DOGFOOD-MATRIX.md
// "Known app/test gaps" #1). Opens the Planner from the Lanes titlebar, builds a two-node plan
// (one job depends on the other) with the real toolbar and React Flow canvas, clicks Run plan,
// and asserts the compiled jobs carry the right dependency: the depended-on job is `ready`, the
// dependent job stays `proposed` until it. No lane or Brain session is needed for this — the
// canvas's own node state comes live from the Brain (planner/api/contract.ts), and `create_job`
// resolves `ready` vs `proposed` from the dependency graph alone (brain-core's `settle`).
//
// React Flow renders connection handles with `data-nodeid`/`data-handlepos` attributes
// (@xyflow/react's Handle component); dragging one to another with raw mouse events is the stable
// way to drive its drag-to-connect canvas from Playwright, which the matrix flagged as needing
// its own investigation. New nodes always spawn at the canvas's exact center
// (planner-canvas.tsx's `addNode`), so the first node is dragged aside before the second is added,
// or they would land on top of each other.
//
// Run: `pnpm run build` at the repo root first, then `node e2e/planner-run-plan.e2e.mjs`.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LONG, addProject, openLanes, step, until } from './brain-e2e.mjs';
import { closeApp, hangWatchdog, launchApp, setContentSize } from './harness.mjs';

const TITLE_A = 'Design the schema';
const TITLE_B = 'Build on it';

const nodeIds = (page) =>
  page
    .locator('[data-testid^="planner-node-"]')
    .evaluateAll((els) => els.map((el) => el.dataset.testid));

/** Clicks "Add job", waits for the new node, fills and commits its title, returns its plain id. */
async function addJobNode(page, title) {
  const before = new Set(await nodeIds(page));
  await page.getByRole('button', { name: 'Add job' }).click();
  const testid = await until('a new planner node to appear', async () => {
    const added = (await nodeIds(page)).find((id) => !before.has(id));
    return added ?? false;
  });
  const id = testid.replace('planner-node-', '');
  const titleInput = page.getByLabel('Title');
  await titleInput.fill(title);
  await titleInput.press('Enter');
  await page
    .locator(`[data-testid="planner-node-${id}"]`)
    .getByText(title, { exact: true })
    .waitFor({ timeout: LONG });
  return id;
}

/** Drags a node's whole card by (dx, dy) so it stops overlapping the next node's spawn point. */
async function dragNodeBy(page, id, dx, dy) {
  const box = await page.locator(`[data-testid="planner-node-${id}"]`).boundingBox();
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/** Drags from one job's source (right) handle to another's target (left) handle. */
async function connectNodes(page, fromId, toId) {
  const source = page.locator(`[data-nodeid="${fromId}"][data-handlepos="right"]`);
  const target = page.locator(`[data-nodeid="${toId}"][data-handlepos="left"]`);
  const [s, t] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move((s.x + t.x) / 2, (s.y + t.y) / 2, { steps: 6 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.up();
}

const dataState = async (page, id) =>
  page.locator(`[data-testid="planner-node-${id}"]`).getAttribute('data-state');

async function main() {
  const { app, page, root, repo } = await launchApp();
  const userData = join(root, 'user-data');
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  step(`profile ${root}`);
  try {
    await page.evaluate(() => localStorage.setItem('emdash:has-seen-onboarding:v1', 'true'));
    await page.reload();
    await setContentSize(app, 1440, 900);

    step('adding the fixture project');
    await addProject(app, page, repo);
    await openLanes(page);

    step('opening the Planner from the Lanes titlebar');
    const openPlanner = page.getByTestId('lanes-open-planner');
    await until('the Planner button to enable', async () => !(await openPlanner.isDisabled()));
    await openPlanner.click();
    await page.getByTestId('planner-canvas').waitFor({ timeout: LONG });
    step('Planner canvas open');

    step(`adding job A ("${TITLE_A}")`);
    const a = await addJobNode(page, TITLE_A);
    await dragNodeBy(page, a, -260, 40);

    step(`adding job B ("${TITLE_B}"), depends on A`);
    const b = await addJobNode(page, TITLE_B);
    await dragNodeBy(page, b, 260, -40);

    step("connecting A -> B (A's source handle to B's target handle)");
    await connectNodes(page, a, b);
    await page.locator('.react-flow__edge').waitFor({ timeout: LONG });
    step('edge drawn');

    step('clicking Run plan');
    await page.getByRole('button', { name: 'Run plan' }).click();
    await page.getByText(/Plan compiled/).waitFor({ timeout: LONG });
    const description = await page.getByText(/created,.*updated,.*archived/).textContent();
    step(`toast: Plan compiled — ${description}`);
    if (!description?.includes('2 created')) {
      throw new Error(`expected "2 created" in the compile toast, got: ${description}`);
    }

    step('checking each node carries the right live Brain state');
    await until(
      'A ready, B proposed',
      async () =>
        (await dataState(page, a)) === 'ready' && (await dataState(page, b)) === 'proposed'
    );
    step(`confirmed: A (no deps) is ready, B (depends on A) is proposed`);

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
  if (process.exitCode) return;

  step('verifying the Brain DB directly: 2 jobs, one edge, right initial states');
  const db = new DatabaseSync(join(userData, 'ninebrains-brain.db'), { readOnly: true });
  const jobs = db
    .prepare('SELECT id, title, state FROM jobs WHERE title IN (?, ?)')
    .all(TITLE_A, TITLE_B);
  const edges = db.prepare('SELECT from_id, to_id FROM job_edges').all();
  db.close();
  const jobA = jobs.find((j) => j.title === TITLE_A);
  const jobB = jobs.find((j) => j.title === TITLE_B);
  const linked = edges.some((e) => e.from_id === jobA?.id && e.to_id === jobB?.id);
  if (jobs.length !== 2 || jobA.state !== 'ready' || jobB.state !== 'proposed' || !linked) {
    process.stderr.write(
      `FAIL: unexpected stored plan: jobs=${JSON.stringify(jobs)} edges=${JSON.stringify(edges)}\n`
    );
    process.exitCode = 1;
    return;
  }
  step(
    `stored: "${TITLE_A}" ${jobA.state}, "${TITLE_B}" ${jobB.state}, edge ${jobA.id} -> ${jobB.id}`
  );
  process.stdout.write(
    'PASS planner-run-plan e2e: Run plan compiled the canvas into Brain jobs with the right dependency\n'
  );
}

hangWatchdog(5 * 60_000);
await main();
process.exit(process.exitCode ?? 0);

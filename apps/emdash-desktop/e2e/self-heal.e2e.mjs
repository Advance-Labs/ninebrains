// Phase 4 exit criterion, end to end: a deliberately broken UI job fails the screenshot gate,
// the feedback reaches the lane's inbox, the (fake) agent fixes the page and calls complete_job
// again, and attempt 2 passes with three screenshots in the evidence dir.
//
// Run with `node e2e/self-heal.e2e.mjs` after `pnpm run build`. Uses tooling/fake-agent only,
// never a real CLI. Kept out of CI like the lanes smoke test.
//
// SKIPPED until the Brain wiring lands. It needs the composition root to construct
// createGatesServices (features/gates/README.md, "Wiring"), the harness to launch with
// --use-mock-keychain, and the four `hooks` below filled in from the Brain's wire contract.
// The guard names whichever precondition is missing and never launches Electron while one is.
// The same loop is proven at service level in CI:
// src/core/features/gates/node/runner/self-heal.test.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WIRING = join(here, '../src/main/bootstrap/boot/ninebrains/create-ninebrains-services.ts');

const unwired = (name) => async () => {
  throw new Error(`self-heal e2e: hooks.${name} is not implemented yet (see the file header)`);
};

/** Integrator: implement these through the Brain's wire contract once it is on main. */
const hooks = {
  /** Adds the lane (fake agent + FAKE_AGENT_SCRIPT), creates the job, returns ids and paths. */
  createUiJob: unwired('createUiJob'),
  /** Points the lane's preview at `url`, so the runner's lane resolver returns it. */
  setLanePreview: unwired('setLanePreview'),
  /** Polls the job until `predicate(job)` holds and returns it. */
  waitForJob: unwired('waitForJob'),
  /** The lane's inbox messages for this job. */
  readLaneInbox: unwired('readLaneInbox'),
  /** Sends a line to the fake agent so it runs the steps after `waitForInput`. */
  resumeAgent: unwired('resumeAgent'),
  implemented: false,
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

const BROKEN = `<!doctype html><title>Hero</title><main id="app"></main>
<script>const hero = undefined; document.getElementById('app').textContent = hero.title;</script>`;
const FIXED = `<!doctype html><title>Hero</title><main id="app"><h1>Renovations, on schedule</h1></main>`;

/** Commits the broken page into the harness's fixture repo, so lanes branch from it. */
function seedBrokenPage(repo) {
  writeFileSync(join(repo, 'index.html'), BROKEN);
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });
  git('add', 'index.html');
  git('commit', '-m', 'broken hero');
}

/** Serves `dir` on a leased loopback port (listen(0)). */
async function serve(dir) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const file = resolve(root, req.url === '/' ? 'index.html' : `.${req.url}`);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

/** Complete, wait for the gate's feedback, fix the page, complete again. */
function fakeAgentScript(jobId) {
  const complete = (summary) => ({
    callTool: { server: 'brain', tool: 'complete_job', args: { jobId, summary } },
  });
  return JSON.stringify([
    complete('Hero built'),
    { waitForInput: true },
    { writeFile: { path: 'index.html', content: FIXED } },
    complete('Fixed the TypeError'),
  ]);
}

async function main() {
  const reason = skipReason();
  if (reason) {
    process.stdout.write(`SKIP self-heal e2e: ${reason}\n`);
    return;
  }
  const { app, repo, root } = await launchApp();
  seedBrokenPage(repo);
  try {
    const { jobId, worktreePath } = await hooks.createUiJob(app, {
      repo,
      title: 'Hero section',
      gateSpec: { gates: ['screenshot'], kind: 'ui' },
      script: fakeAgentScript,
    });
    const { server, url } = await serve(worktreePath);
    try {
      await hooks.setLanePreview(app, jobId, url);
      await hooks.waitForJob(app, jobId, (job) => job.state === 'running' && job.attempts === 1);
      const inbox = await hooks.readLaneInbox(app, jobId);
      if (!inbox.some((message) => message.body.includes('console error'))) {
        throw new Error('the screenshot gate feedback did not reach the lane inbox');
      }
      await hooks.resumeAgent(app, jobId);
      const done = await hooks.waitForJob(app, jobId, (job) => job.state === 'done');
      const verification = done.result?.verification;
      if (!verification?.verified || verification.attempt !== 2) {
        throw new Error(
          `expected a verified pass on attempt 2, got ${JSON.stringify(done.result)}`
        );
      }
      const evidence = join(root, 'user-data', 'ninebrains', 'evidence', jobId, '2');
      const shots = readdirSync(evidence).filter((file) => file.startsWith('screenshot-'));
      if (shots.length !== 3) throw new Error(`expected 3 screenshots, found ${shots.join(', ')}`);
      process.stdout.write(`PASS self-heal e2e: attempt 2 verified, evidence in ${evidence}\n`);
    } finally {
      server.close();
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});

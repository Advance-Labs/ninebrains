// Run: node --test tooling/scripts/claude-heavy-gate.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { heavyCommandProblem, hookResponse } from './claude-heavy-gate.mjs';
import { acquireGateSlot } from './gate-slots.mjs';
import { runGated } from './gated.mjs';

describe('heavyCommandProblem', () => {
  it('flags the heavy commands agents ran side by side on 2026-11-12', () => {
    for (const cmd of [
      'ls node_modules >/dev/null 2>&1 || pnpm install --frozen-lockfile --ignore-scripts',
      'cd apps/emdash-desktop && pnpm exec tsgo --noEmit -p tsconfig.node.json',
      'pnpm --dir apps/emdash-desktop run typecheck 2>&1 | tail -8',
      'npx vitest run src/x.test.ts',
      'pnpm nx build @emdash/ui',
      'pnpm exec nx affected -t lint typecheck test',
      'pnpm run check',
      'timeout 300 pnpm exec vitest run --project node',
      'cd packages/wire && pnpm run typecheck 2>&1 | tail -4',
      'pnpm nx run emdash-desktop:test',
      "sh -c 'pnpm exec tsgo --noEmit'",
      'cd apps/console && npx next build',
      'pnpm turbo run build --filter=console',
      'npm ci',
      'bun run test',
      'timeout -k 5 300 pnpm test',
      'echo gated.mjs; pnpm test',
      'node tooling/scripts/gated.mjs pnpm run build && pnpm test',
    ]) {
      assert.ok(heavyCommandProblem(cmd), cmd);
    }
  });

  it('lets light and already-gated commands through', () => {
    for (const cmd of [
      'git status',
      'pnpm exec oxlint src/a.ts',
      'grep -rn "typecheck" package.json',
      'ls vitest.config.ts && cat tsconfig.json',
      'pnpm run format:check',
      'pnpm exec nx show projects',
      'git push --force-with-lease origin HEAD:fix/x',
      'node tooling/scripts/gated.mjs pnpm run typecheck',
      "cd apps/x && node /r/tooling/scripts/gated.mjs sh -c 'pnpm test && pnpm run build'",
    ]) {
      assert.equal(heavyCommandProblem(cmd), null, cmd);
    }
  });
});

describe('watch and quoting', () => {
  it('does not gate long-running watch runs', () => {
    for (const cmd of [
      'pnpm run test:watch',
      'pnpm test:watch',
      'pnpm --dir apps/emdash-desktop run typecheck:watch',
      'pnpm exec vitest --watch',
      'npx vitest watch src/x.test.ts',
      'pnpm test -- --watch',
      'pnpm exec vitest run --watch=false --watchAll',
    ]) {
      assert.equal(heavyCommandProblem(cmd), null, cmd);
    }
    assert.ok(heavyCommandProblem('pnpm run test'));
    assert.ok(heavyCommandProblem('pnpm exec vitest run'));
  });

  it('does not split on operators inside quotes', () => {
    for (const cmd of [
      'echo "a; pnpm run build"',
      "git commit -m 'fix: x && pnpm test'",
      'grep -rn "a|pnpm install" src',
    ]) {
      assert.equal(heavyCommandProblem(cmd), null, cmd);
    }
    assert.ok(heavyCommandProblem("echo 'a;b'; pnpm run build"));
    assert.ok(heavyCommandProblem("sh -c 'git status && pnpm run build'"));
  });

  it('shell-quotes a gated.mjs path with spaces, and the quoted form counts as gated', () => {
    const gatedPath = "/Users/a b/it's/gate/gated.mjs";
    const out = hookResponse({ tool_input: { command: 'pnpm run build' } }, gatedPath);
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    const suggested = reason.split('\n').find((l) => l.startsWith('node '));
    assert.match(
      suggested,
      /^node '\/Users\/a b\/it'\\''s\/gate\/gated\.mjs' sh -c 'pnpm run build'$/
    );
    assert.equal(heavyCommandProblem(suggested), null);
    assert.equal(heavyCommandProblem(`cd '/a b/c' && ${suggested}`), null);
    assert.ok(heavyCommandProblem(`${suggested} && pnpm run build`));
  });
});

describe('hookResponse', () => {
  it('denies with a runnable gated command that keeps single quotes intact', () => {
    const out = hookResponse({ tool_input: { command: "pnpm test -- -t 'a b'" } }, '/r/gated.mjs');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(
      out.hookSpecificOutput.permissionDecisionReason,
      /node \/r\/gated\.mjs sh -c 'pnpm test -- -t '\\''a b'\\'''/
    );
  });
});

describe('gated', () => {
  const fakeChild = () => Object.assign(new EventEmitter(), { pid: 4242, kill() {} });

  it('holds a slot for the run, marks the child, and passes the exit code through', async () => {
    let held = false;
    const child = fakeChild();
    const run = runGated(['x'], {
      env: {},
      acquire: () => {
        held = true;
        return () => (held = false);
      },
      spawn: (_cmd, _args, opts) => {
        assert.ok(held);
        assert.equal(opts.env.NINEBRAINS_GATE_HELD, String(process.pid));
        assert.equal(opts.detached, true);
        return child;
      },
      proc: new EventEmitter(),
    });
    child.emit('close', 3, null);
    assert.equal(await run, 3);
    assert.equal(held, false);
  });

  it('forwards a termination signal to the child group and releases the slot only after it exits', async () => {
    let held = true;
    const child = fakeChild();
    const proc = new EventEmitter();
    const killed = [];
    const run = runGated(['x'], {
      env: {},
      acquire: () => () => (held = false),
      spawn: () => child,
      proc,
      kill: (pid, sig) => killed.push([pid, sig]),
    });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) proc.emit(sig);
    assert.deepEqual(killed, [
      [-4242, 'SIGINT'],
      [-4242, 'SIGTERM'],
      [-4242, 'SIGHUP'],
    ]);
    assert.equal(held, true); // child still alive: the slot is still held
    child.emit('close', null, 'SIGTERM');
    assert.equal(await run, 128 + 15);
    assert.equal(held, false);
    assert.equal(proc.listenerCount('SIGTERM'), 0);
  });

  it('kills the real child when the gate itself is terminated', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gated-'));
    const pidFile = path.join(dir, 'pid');
    const gate = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./gated.mjs', import.meta.url)),
        'sh',
        '-c',
        `echo $$ > '${pidFile}'; sleep 30`,
      ],
      { env: { ...process.env, NINEBRAINS_GATE_HELD: String(process.pid) } }
    );
    const exited = new Promise((resolve) => gate.on('close', (code, sig) => resolve([code, sig])));
    for (let i = 0; i < 100 && !existsSync(pidFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    const childPid = Number(readFileSync(pidFile, 'utf8'));
    gate.kill('SIGTERM');
    assert.deepEqual(await exited, [143, null]);
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('reuses a held slot only while its holder is alive', () => {
    const held = { NINEBRAINS_GATE_HELD: String(process.pid) };
    assert.doesNotThrow(() => acquireGateSlot({ env: held, dir: '/nonexistent' })());
    let slept = false;
    acquireGateSlot({
      env: { NINEBRAINS_GATE_HELD: '999999999' },
      slots: 1,
      dir: '/nonexistent/x',
      sleep: () => (slept = true),
    })();
    assert.equal(slept, false); // dead holder: fell through to a normal acquire (here: no dir)
  });
});

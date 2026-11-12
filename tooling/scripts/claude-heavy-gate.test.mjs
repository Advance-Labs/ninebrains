// Run: node --test tooling/scripts/claude-heavy-gate.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
      "echo gated.mjs; pnpm test",
      "node tooling/scripts/gated.mjs pnpm run build && pnpm test",
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

describe('hookResponse', () => {
  it('denies with a runnable gated command that keeps single quotes intact', () => {
    const out = hookResponse({ tool_input: { command: "pnpm test -- -t 'a b'" } }, '/r/gated.mjs');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /node \/r\/gated\.mjs sh -c 'pnpm test -- -t '\\''a b'\\'''/);
  });
});

describe('gated', () => {
  it('holds a slot for the run, marks the child, and passes the exit code through', () => {
    let held = false;
    const status = runGated(['x'], {
      env: {},
      acquire: () => {
        held = true;
        return () => (held = false);
      },
      run: (_cmd, _args, opts) => {
        assert.ok(held);
        assert.equal(opts.env.NINEBRAINS_GATE_HELD, String(process.pid));
        return { status: 3 };
      },
    });
    assert.equal(status, 3);
    assert.equal(held, false);
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

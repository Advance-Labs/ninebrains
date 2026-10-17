// Run: node --test tooling/scripts/gate-slots.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { acquireGateSlot, slotCount } from './gate-slots.mjs';

const GIB = 1024 ** 3;
const dirs = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-slots-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('slotCount', () => {
  it('is one per 8 GB of RAM, at least one, unless NINEBRAINS_GATE_SLOTS says otherwise', () => {
    assert.equal(slotCount({}, 16 * GIB), 2);
    assert.equal(slotCount({}, 4 * GIB), 1);
    assert.equal(slotCount({}, 64 * GIB), 8);
    assert.equal(slotCount({ NINEBRAINS_GATE_SLOTS: '1' }, 64 * GIB), 1);
    assert.equal(slotCount({ NINEBRAINS_GATE_SLOTS: 'lots' }, 16 * GIB), 2);
  });
});

describe('acquireGateSlot', () => {
  const base = (dir, extra = {}) => ({ dir, slots: 2, isAlive: () => true, log: () => {}, ...extra });

  it('hands out up to the limit, and a released slot is free again', () => {
    const dir = freshDir();
    const a = acquireGateSlot(base(dir, { owner: { pid: 1, cwd: '/w/a' } }));
    const b = acquireGateSlot(base(dir, { owner: { pid: 2, cwd: '/w/b' } }));
    assert.equal(readdirSync(dir).length, 2);
    a();
    assert.equal(readdirSync(dir).length, 1);
    b();
    assert.equal(readdirSync(dir).length, 0);
  });

  it('waits while every slot is busy, says who holds them, and proceeds when one frees', () => {
    const dir = freshDir();
    const a = acquireGateSlot(base(dir, { owner: { pid: 1, cwd: '/w/agent-a' } }));
    acquireGateSlot(base(dir, { owner: { pid: 2, cwd: '/w/agent-b' } }));
    const logs = [];
    let naps = 0;
    const c = acquireGateSlot(
      base(dir, {
        owner: { pid: 3, cwd: '/w/agent-c' },
        log: (line) => logs.push(line),
        sleep: () => {
          naps += 1;
          if (naps === 2) a(); // agent-a finishes while agent-c waits
        },
      })
    );
    assert.equal(naps, 2);
    assert.match(logs[0], /all 2 gate slot\(s\) busy \(pid 1 in agent-a, pid 2 in agent-b\)/);
    assert.match(logs.at(-1), /got a gate slot/);
    c();
  });

  it('reclaims a slot whose owner died, instead of waiting forever', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'slot-0'), JSON.stringify({ pid: 999_999, cwd: '/w/crashed' }));
    writeFileSync(join(dir, 'slot-1'), JSON.stringify({ pid: 999_998, cwd: '/w/crashed-too' }));
    let slept = false;
    const release = acquireGateSlot(
      base(dir, { owner: { pid: 7, cwd: '/w/x' }, isAlive: () => false, sleep: () => (slept = true) })
    );
    assert.equal(slept, false);
    release();
  });

  it('only frees its own slot', () => {
    const dir = freshDir();
    const release = acquireGateSlot(base(dir, { slots: 1, owner: { pid: 1, cwd: '/w/a' } }));
    // Someone reclaimed it meanwhile (say this owner was presumed dead).
    writeFileSync(join(dir, 'slot-0'), JSON.stringify({ pid: 2, cwd: '/w/b' }));
    release();
    assert.ok(existsSync(join(dir, 'slot-0')));
  });

  it('runs anyway after the maximum wait, rather than blocking a push for ever', () => {
    const dir = freshDir();
    acquireGateSlot(base(dir, { slots: 1, owner: { pid: 1, cwd: '/w/a' } }));
    let clock = 0;
    const logs = [];
    const release = acquireGateSlot(
      base(dir, {
        slots: 1,
        owner: { pid: 2, cwd: '/w/b' },
        now: () => clock,
        sleep: () => (clock += 60_000),
        maxWaitMs: 5 * 60_000,
        log: (line) => logs.push(line),
      })
    );
    assert.match(logs.at(-1), /waited 5 min for a gate slot; running anyway/);
    release(); // a no-op: it never held one
    assert.equal(readdirSync(dir).length, 1);
  });
});

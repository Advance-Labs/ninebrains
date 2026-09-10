import { describe, expect, it } from 'vitest';
import { runGates } from './run-gates';
import { makeContext, makeJob } from './test-utils';
import type { Gate, GateResult } from './types';

function gate(id: string, run: Gate['run'], appliesTo: Gate['appliesTo'] = () => true): Gate {
  return { id, title: id.toUpperCase(), appliesTo, run };
}

const passing = (id: string) =>
  gate(id, async () => ({ pass: true, evidence: [], feedback: `${id} ok` }));
const failing = (id: string, feedback = `${id} broke`) =>
  gate(id, async () => ({ pass: false, evidence: [], feedback }));

describe('runGates', () => {
  it('passes only when every applicable gate passes', async () => {
    const job = makeJob();
    const ok = await runGates(job, [passing('a'), passing('b')], makeContext());
    expect(ok.pass).toBe(true);
    expect(ok.feedback).toBe('All 2 verification gates passed.');

    const bad = await runGates(job, [passing('a'), failing('b', 'fix the header')], makeContext());
    expect(bad.pass).toBe(false);
    expect(bad.results.map((r) => r.status)).toEqual(['pass', 'fail']);
    expect(bad.feedback).toContain('1 of 2 gates did not pass');
    expect(bad.feedback).toContain('## B (b) failed\nfix the header');
    expect(bad.feedback).not.toContain('a ok');
  });

  it('skips gates that do not apply, and a job with none passes vacuously', async () => {
    const report = await runGates(
      makeJob(),
      [failing('x')].map((g) => ({ ...g, appliesTo: () => false })),
      makeContext()
    );
    expect(report).toMatchObject({ pass: true, skipped: ['x'], results: [] });
    expect(report.feedback).toBe('No verification gates applied to this job.');
  });

  it('fails a gate that times out, and aborts its signal', async () => {
    let aborted = false;
    const hang = gate('hang', (ctx) => {
      ctx.signal.addEventListener('abort', () => (aborted = true));
      return new Promise<GateResult>(() => undefined);
    });
    const report = await runGates(makeJob(), [hang, passing('ok')], makeContext(), {
      timeoutMs: 20,
    });
    expect(report.pass).toBe(false);
    expect(report.results[0]).toMatchObject({ status: 'timeout', pass: false });
    expect(report.results[0].feedback).toMatch(/did not finish/);
    expect(aborted).toBe(true);
  });

  it('fails a gate that throws, synchronously or asynchronously', async () => {
    const sync = gate('sync', () => {
      throw new Error('boom');
    });
    const async_ = gate('async', async () => {
      throw new Error('kaboom');
    });
    const report = await runGates(makeJob(), [sync, async_], makeContext());
    expect(report.results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(report.results[0].feedback).toContain('boom');
    expect(report.results[1].feedback).toContain('kaboom');
  });

  it('fails a gate whose appliesTo throws, and one that returns a malformed result', async () => {
    const picky = gate(
      'picky',
      async () => ({ pass: true, evidence: [], feedback: '' }),
      () => {
        throw new Error('bad job');
      }
    );
    const sloppy = gate('sloppy', async () => ({ pass: 'yes' }) as unknown as GateResult);
    const report = await runGates(makeJob(), [picky, sloppy], makeContext());
    expect(report.pass).toBe(false);
    expect(report.results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(report.results[0].feedback).toContain('bad job');
    expect(report.results[1].feedback).toMatch(/malformed/);
  });

  it('respects the concurrency limit and keeps results in gate order', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = (id: string, ms: number) =>
      gate(id, async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, ms));
        inFlight -= 1;
        return { pass: true, evidence: [], feedback: id };
      });
    const report = await runGates(
      makeJob(),
      [slow('a', 30), slow('b', 5), slow('c', 5), slow('d', 5)],
      makeContext(),
      { concurrency: 2 }
    );
    expect(peak).toBe(2);
    expect(report.results.map((r) => r.gateId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('marks gates cancelled when the parent signal aborts', async () => {
    const controller = new AbortController();
    const hang = gate('hang', () => new Promise<GateResult>(() => undefined));
    const pending = runGates(
      makeJob(),
      [hang, passing('later')],
      makeContext({ signal: controller.signal }),
      {
        concurrency: 1,
      }
    );
    setTimeout(() => controller.abort(), 10);
    const report = await pending;
    expect(report.results.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(report.pass).toBe(false);
  });

  it('collects evidence from every gate', async () => {
    const withEvidence = gate('e', async () => ({
      pass: true,
      evidence: [{ kind: 'log', path: '/x/e.log', label: 'log' }],
      feedback: '',
    }));
    const report = await runGates(makeJob(), [withEvidence, withEvidence], makeContext());
    expect(report.evidence).toHaveLength(2);
  });
});

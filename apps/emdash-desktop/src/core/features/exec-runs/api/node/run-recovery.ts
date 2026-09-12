/**
 * SEC-29, restart half: budget counters survive an app restart.
 *
 * While a run is live the supervisor appends a `ninebrains.budget` record to its transcript on
 * every usage event (tokens so far, elapsed time). If the app dies mid-run, the transcript has a
 * header and no `ninebrains.outcome`. At the next start, `recoverInterruptedRuns` closes each
 * such transcript as `killed` with its last persisted counters, and deletes the run's leftover
 * config dir (settings and `mcp.json`, which holds tokens). It never signals the old pids: after
 * a restart they may belong to unrelated processes.
 */
import { appendFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runsDir } from './run-paths';
import { emptyUsage, totalTokens, type ExecPreset, type ExecProvider, type TokenUsage } from './types';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface RecoveredRun {
  runId: string;
  provider?: ExecProvider;
  preset?: ExecPreset;
  usage: TokenUsage;
  totalTokens: number;
  elapsedMs: number;
  transcriptPath: string;
}

interface Scan {
  header?: { provider?: ExecProvider; preset?: ExecPreset };
  budget?: { usage?: TokenUsage; elapsedMs?: number };
  finished: boolean;
}

function scan(text: string): Scan {
  const out: Scan = { finished: false };
  for (const line of text.split('\n')) {
    if (!line.startsWith('{"type":"ninebrains.')) continue; // CLI lines can't spoof records
    let record: { type?: string } & Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type === 'ninebrains.header') out.header = record as Scan['header'];
    else if (record.type === 'ninebrains.budget') out.budget = record as Scan['budget'];
    else if (record.type === 'ninebrains.outcome') out.finished = true;
  }
  return out;
}

/** Call once at startup, before any run starts: every open transcript then belongs to a dead app. */
export async function recoverInterruptedRuns(userDataDir: string): Promise<RecoveredRun[]> {
  const dir = runsDir(userDataDir);
  const names = await readdir(dir).catch(() => [] as string[]);
  const recovered: RecoveredRun[] = [];
  for (const name of names.sort()) {
    const runId = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : '';
    if (!SAFE_ID.test(runId)) continue;
    const transcriptPath = join(dir, name);
    const found = scan(await readFile(transcriptPath, 'utf8'));
    if (!found.header || found.finished) continue;
    const usage = { ...emptyUsage(), ...found.budget?.usage };
    const run: RecoveredRun = {
      runId,
      provider: found.header.provider,
      preset: found.header.preset,
      usage,
      totalTokens: totalTokens(usage),
      elapsedMs: found.budget?.elapsedMs ?? 0,
      transcriptPath,
    };
    const outcome = {
      type: 'ninebrains.outcome',
      at: new Date().toISOString(),
      runId,
      ok: false,
      reason: 'killed',
      recovered: true,
      errors: ['the app stopped while this run was active'],
      usage,
      totalTokens: run.totalTokens,
      durationMs: run.elapsedMs,
    };
    await appendFile(transcriptPath, `${JSON.stringify(outcome)}\n`, 'utf8');
    await rm(join(dir, runId), { recursive: true, force: true });
    recovered.push(run);
  }
  return recovered;
}

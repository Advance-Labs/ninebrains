/**
 * Run transcript: `<userData>/ninebrains/runs/<runId>.jsonl`, mode 0600, created with `wx` so it
 * is never world-readable for a moment and never overwrites another run. Every line passes
 * through the SEC-35 redactor before it reaches disk.
 */
import { open, type FileHandle } from 'node:fs/promises';
import type { Redactor } from './redact';

export class TranscriptWriter {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly handle: FileHandle,
    private readonly redact: Redactor,
    readonly path: string
  ) {}

  static async create(path: string, redact: Redactor): Promise<TranscriptWriter> {
    const handle = await open(path, 'wx', 0o600);
    return new TranscriptWriter(handle, redact, path);
  }

  /** Records a stdout line verbatim (after redaction); it is already JSON from the CLI. */
  raw(line: string): void {
    this.append(line);
  }

  /** Records a Ninebrains-authored record, e.g. the header, stderr or the final outcome. */
  record(type: string, data: Record<string, unknown>): void {
    this.append(
      JSON.stringify({ type: `ninebrains.${type}`, at: new Date().toISOString(), ...data })
    );
  }

  private append(line: string): void {
    if (this.closed) return;
    const text = this.redact(line.replace(/\r?\n$/, '')) + '\n';
    this.queue = this.queue.then(() => this.handle.appendFile(text, 'utf8')).catch(() => {});
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    await this.handle.close();
  }
}

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAndHash } from './download';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-dl-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function streamResponse(chunks: string[], status = 200): Response {
  const source = Readable.from(chunks.map((text) => Buffer.from(text)));
  const body = Readable.toWeb(source);
  return new Response(body, {
    status,
    headers: { 'content-length': String(Buffer.byteLength(chunks.join(''))) },
  });
}

describe('downloadAndHash', () => {
  it('writes the payload and returns its sha256 and byte count', async () => {
    const payload = 'Ninebrains update bytes';
    const fetchImpl = vi.fn(async () => streamResponse([payload]));
    const dest = join(dir, 'staged', 'Ninebrains-0.2.2-mac-arm64.zip');
    const progress: number[] = [];

    const result = await downloadAndHash(dest, dest, (p) => progress.push(p.percent), fetchImpl);

    expect(result).toEqual({
      sha256: createHash('sha256').update(payload).digest('hex'),
      bytes: Buffer.byteLength(payload),
    });
    expect(await fsp.readFile(dest, 'utf8')).toBe(payload);
    expect(progress.at(-1)).toBe(100);
  });

  it('reports it cannot know the total when content-length is absent', async () => {
    const fetchImpl = vi.fn(async () => {
      const source = Readable.from([Buffer.from('abc')]);
      return new Response(Readable.toWeb(source));
    });
    const dest = join(dir, 'x.bin');
    const reported: number[] = [];
    await downloadAndHash(dest, dest, (p) => reported.push(p.percent), fetchImpl);
    expect(reported[0]).toBe(-1);
  });

  it('throws on HTTP errors and leaves no file behind', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(
      downloadAndHash(join(dir, 'x.bin'), join(dir, 'x.bin'), vi.fn(), fetchImpl)
    ).rejects.toThrow(/HTTP 503/);
    await expect(fsp.stat(join(dir, 'x.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans up a partial file when the stream errors mid-transfer', async () => {
    const failing = new ReadableStream<any>({
      start(controller) {
        controller.enqueue(Buffer.from('partial bytes'));
        controller.error(new Error('connection reset'));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(failing));
    const dest = join(dir, 'partial.bin');
    await expect(downloadAndHash(dest, dest, vi.fn(), fetchImpl)).rejects.toThrow(
      /connection reset/
    );
    await expect(fsp.stat(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

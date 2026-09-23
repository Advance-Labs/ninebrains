import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableWebStream } from 'node:stream/web';

export type DownloadProgress = {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
};

type ProgressReporter = (progress: DownloadProgress, incrementalBytes: number) => void;

/**
 * Streams `url` to `destPath`, reporting read progress. Returns the final sha256 in hex. The caller
 * is responsible for comparing the hash to the signed digest; this function never trusts the byte
 * stream it received.
 */
export async function downloadAndHash(
  url: string,
  destPath: string,
  report: ProgressReporter,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
): Promise<{ sha256: string; bytes: number }> {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'ninebrains-updater' } });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  if (!response.body) throw new Error(`Download returned no body: ${url}`);

  const total = parseContentLength(response.headers.get('content-length'));
  const directory = dirname(destPath);
  await fsp.mkdir(directory, { recursive: true });

  const hash = createHash('sha256');
  let transferred = 0;
  let chunkBytes = 0;
  let lastTick = Date.now();
  let lastBytes = 0;
  let runningByteRate = 0;
  const startedAt = Date.now();

  report({ bytesPerSecond: 0, percent: total > 0 ? 0 : -1, transferred: 0, total }, 0);

  const sink = createWriteStream(destPath, { flags: 'w' });
  sink.on('finish', () => sink.end());
  const source = Readable.fromWeb(response.body as unknown as NodeReadableWebStream);
  source.on('data', (chunk: Buffer) => {
    transferred += chunk.length;
    chunkBytes += chunk.length;
    hash.update(chunk);
  });

  const throttle = setInterval(() => {
    if (chunkBytes === 0) return;
    const now = Date.now();
    const elapsedMs = now - lastTick;
    if (elapsedMs <= 0) return;
    runningByteRate = (chunkBytes * 1000) / elapsedMs;
    lastTick = now;
    chunkBytes = 0;
    report(
      {
        bytesPerSecond: Math.round(runningByteRate),
        percent: total > 0 ? Math.min(100, (transferred / total) * 100) : -1,
        transferred,
        total,
      },
      runningByteRate
    );
    lastBytes = runningByteRate;
  }, 500);

  try {
    await pipeline(source, sink);
  } catch (error) {
    clearInterval(throttle);
    await fsp.rm(destPath, { force: true });
    throw error;
  } finally {
    clearInterval(throttle);
  }

  // A final, exact report so the UI lands on 100% regardless of the throttler's cadence.
  const finalElapsedMs = Math.max(1, Date.now() - startedAt);
  report(
    {
      bytesPerSecond: Math.round((transferred * 1000) / finalElapsedMs) || lastBytes,
      percent: 100,
      transferred,
      total,
    },
    lastBytes
  );

  const sha256 = hash.digest('hex');
  if (sha256 === '') throw new Error('Download produced no bytes');
  return { sha256, bytes: transferred };
}

function parseContentLength(value: string | null): number {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Test helpers. Not exported from the package entry. */

import { PNG } from 'pngjs';
import type { Evidence, EvidenceStore, GateCapabilities, GateContext, GateTask } from './types';

export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [255, 255, 255],
  patch?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }
): Uint8Array {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inPatch =
        patch && x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
      const [r, g, b] = inPatch ? patch.rgb : rgb;
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

export function makeTask(overrides: Partial<GateTask> = {}): GateTask {
  return {
    id: 'task-1',
    title: 'Add a pricing table',
    body: 'Show three plans side by side; stack them on mobile.',
    kind: 'ui',
    attempt: 1,
    ...overrides,
  };
}

export interface MemoryEvidenceStore extends EvidenceStore {
  data: Map<string, string | Uint8Array>;
}

export function memoryEvidence(): MemoryEvidenceStore {
  const entries: Evidence[] = [];
  const data = new Map<string, string | Uint8Array>();
  return {
    dir: '/mem',
    data,
    async put(input) {
      const path = `/mem/${input.fileName}`;
      data.set(path, input.data);
      const evidence: Evidence = { kind: input.kind, path, label: input.label };
      entries.push(evidence);
      return evidence;
    },
    list: () => [...entries],
  };
}

function notMocked(name: string) {
  return async () => {
    throw new Error(`${name} is not mocked in this test`);
  };
}

export function makeContext(
  opts: {
    task?: Partial<GateTask>;
    previewUrl?: string;
    capabilities?: Partial<GateCapabilities>;
    signal?: AbortSignal;
  } = {}
): GateContext & { evidence: MemoryEvidenceStore } {
  return {
    task: makeTask(opts.task),
    worktreePath: '/work/lane-1',
    previewUrl: opts.previewUrl,
    evidence: memoryEvidence(),
    signal: opts.signal ?? new AbortController().signal,
    capabilities: {
      captureScreenshot: notMocked('captureScreenshot'),
      runCommand: notMocked('runCommand'),
      spawnReviewer: notMocked('spawnReviewer'),
      fetchText: notMocked('fetchText'),
      readWorktreeFile: notMocked('readWorktreeFile'),
      ...opts.capabilities,
    },
  };
}

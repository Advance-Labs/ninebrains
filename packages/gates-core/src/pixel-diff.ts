import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface PixelDiffOptions {
  /** Per-pixel colour distance tolerance, 0..1. Default 0.1 (pixelmatch's default). */
  threshold?: number;
  /** Count anti-aliased pixels as differences. Default false. */
  includeAA?: boolean;
}

export interface PixelDiffResult {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  /** diffPixels / totalPixels. 1 when the sizes differ. */
  ratio: number;
  sizeMismatch: boolean;
  /** PNG highlighting the differing pixels. Absent on a size mismatch. */
  diffPng?: Uint8Array;
}

/** Compare two PNGs. A size change is reported as a full mismatch rather than thrown. */
export function pixelDiff(
  a: Uint8Array,
  b: Uint8Array,
  options: PixelDiffOptions = {}
): PixelDiffResult {
  const imgA = PNG.sync.read(Buffer.from(a));
  const imgB = PNG.sync.read(Buffer.from(b));

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    return {
      width,
      height,
      diffPixels: width * height,
      totalPixels: width * height,
      ratio: 1,
      sizeMismatch: true,
    };
  }

  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: options.includeAA ?? false,
  });
  const totalPixels = width * height;
  return {
    width,
    height,
    diffPixels,
    totalPixels,
    ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    sizeMismatch: false,
    diffPng: new Uint8Array(PNG.sync.write(diff)),
  };
}

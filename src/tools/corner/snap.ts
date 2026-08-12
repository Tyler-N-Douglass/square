/**
 * Snap-assist — SPEC §4.3.1.2: optionally snap a marked point to the local
 * gradient maximum within ±6 px. Cheap Sobel on a small luminance patch;
 * pure and DOM-free (the caller extracts the patch via getImageData).
 * Off by default, skippable — a snap that cannot find a clear edge returns
 * null and the mark stays where the finger put it.
 */

export interface LumaPatch {
  w: number;
  h: number;
  /** Row-major luminance, length w*h. */
  data: Float32Array;
}

/** Search radius, px — SPEC §4.3.1.2. */
export const SNAP_RADIUS_PX = 6;

/** ImageData RGBA → luminance patch (Rec. 601 weights). */
export function lumaFromRgba(width: number, height: number, rgba: Uint8ClampedArray): LumaPatch {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[i] = 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return { w: width, h: height, data };
}

/** Sobel gradient magnitude over the patch. Border pixels get 0. */
export function sobelMagnitude(patch: LumaPatch): Float32Array {
  const { w, h, data } = patch;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1]!, t = data[i - w]!, tr = data[i - w + 1]!;
      const l = data[i - 1]!, r = data[i + 1]!;
      const bl = data[i + w - 1]!, b = data[i + w]!, br = data[i + w + 1]!;
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

export interface SnapResult {
  /** Patch coordinates of the gradient maximum. */
  x: number;
  y: number;
  /** Peak gradient magnitude and the disk median it had to beat. */
  peak: number;
  median: number;
}

/**
 * Local gradient maximum within `radius` of (cx, cy) in patch coordinates.
 * Returns null when there is no clear edge: the best magnitude must beat
 * 2× the median magnitude over the search disk (a flat or noisy patch does
 * not get to move the user's mark).
 */
export function snapToGradientMax(
  patch: LumaPatch,
  cx: number,
  cy: number,
  radius = SNAP_RADIUS_PX,
): SnapResult | null {
  const mag = sobelMagnitude(patch);
  const { w, h } = patch;
  let best = -1;
  let bx = 0;
  let by = 0;
  const disk: number[] = [];
  const r2 = radius * radius;
  const x0 = Math.max(1, Math.floor(cx - radius));
  const x1 = Math.min(w - 2, Math.ceil(cx + radius));
  const y0 = Math.max(1, Math.floor(cy - radius));
  const y1 = Math.min(h - 2, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const m = mag[y * w + x]!;
      disk.push(m);
      if (m > best) {
        best = m;
        bx = x;
        by = y;
      }
    }
  }
  if (disk.length === 0 || best <= 0) return null;
  disk.sort((a, b) => a - b);
  const median = disk[Math.floor(disk.length / 2)]!;
  if (best < 2 * median || best < 1e-6) return null;
  return { x: bx, y: by, peak: best, median };
}

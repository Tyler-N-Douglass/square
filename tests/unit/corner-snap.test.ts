/**
 * Snap-assist patch math (SPEC §4.3.1.2): Sobel gradient maximum within
 * ±6 px, refusing to move the mark when there is no clear edge.
 */
import { describe, expect, it } from 'vitest';
import {
  lumaFromRgba,
  snapToGradientMax,
  sobelMagnitude,
  SNAP_RADIUS_PX,
  type LumaPatch,
} from '../../src/tools/corner/snap';

function patchFrom(fn: (x: number, y: number) => number, w = 32, h = 32): LumaPatch {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
  return { w, h, data };
}

describe('lumaFromRgba', () => {
  it('applies Rec.601 weights', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const p = lumaFromRgba(2, 1, rgba);
    expect(p.data[0]).toBeCloseTo(0.299 * 255, 3);
    expect(p.data[1]).toBeCloseTo(0.587 * 255, 3);
  });
});

describe('sobelMagnitude', () => {
  it('is zero on a flat patch and strong along a step edge', () => {
    const flat = sobelMagnitude(patchFrom(() => 100));
    expect(Math.max(...flat)).toBe(0);
    const step = sobelMagnitude(patchFrom((x) => (x < 16 ? 20 : 220)));
    // Strongest response in the columns adjacent to the step.
    let bestX = -1;
    let best = -1;
    for (let x = 1; x < 31; x++) {
      const m = step[16 * 32 + x]!;
      if (m > best) {
        best = m;
        bestX = x;
      }
    }
    expect([15, 16]).toContain(bestX);
  });
});

describe('snapToGradientMax', () => {
  it('snaps to a step edge within the ±6 px radius', () => {
    const patch = patchFrom((x) => (x < 16 ? 20 : 220));
    const hit = snapToGradientMax(patch, 12, 16, SNAP_RADIUS_PX);
    expect(hit).not.toBeNull();
    expect([15, 16]).toContain(hit!.x);
    expect(Math.abs(hit!.y - 16)).toBeLessThanOrEqual(SNAP_RADIUS_PX);
  });

  it('refuses on a flat patch — the mark stays where the finger put it', () => {
    expect(snapToGradientMax(patchFrom(() => 128), 16, 16)).toBeNull();
  });

  it('refuses on a uniform ramp (no LOCAL maximum: max ≈ median)', () => {
    // Constant slope: every interior Sobel magnitude is identical, so the
    // "peak" is not distinguished and snapping would be arbitrary.
    expect(snapToGradientMax(patchFrom((x) => 4 * x), 16, 16)).toBeNull();
  });

  it('an edge outside the radius does not capture the mark', () => {
    const patch = patchFrom((x) => (x < 26 ? 20 : 220));
    const hit = snapToGradientMax(patch, 8, 16, SNAP_RADIUS_PX);
    expect(hit).toBeNull();
  });
});

/**
 * Homography (normalized DLT + in-repo Gaussian elimination) tests —
 * SPEC §4.3.1.6, §10.1. Owned by A3 (Geometry/Vision).
 * All randomness is seeded (mulberry32) — no Math.random in tests.
 */
import { describe, expect, it } from 'vitest';
import type { Mat3 } from '../../src/types';
import type { Px } from '../../src/geometry/angleSolver';
import {
  applyHomography,
  homographyFromCorrespondences,
  homographyUnitSquareToQuad,
  solveLinear,
  UNIT_SQUARE,
} from '../../src/geometry/homography';
import { mat3Inverse } from '../../src/geometry/mat';
import { mulberry32 } from '../../src/geometry/montecarlo';

/** Seeded random convex quad: perturbed rectangle corners, resampled until convex. */
function randomConvexQuad(rand: () => number): [Px, Px, Px, Px] {
  for (;;) {
    const w = 200 + 1200 * rand();
    const h = 200 + 900 * rand();
    const ox = 1500 * rand();
    const oy = 900 * rand();
    const jitter = () => (rand() - 0.5) * 0.45 * Math.min(w, h);
    const quad: [Px, Px, Px, Px] = [
      { x: ox + jitter(), y: oy + jitter() },
      { x: ox + w + jitter(), y: oy + jitter() },
      { x: ox + w + jitter(), y: oy + h + jitter() },
      { x: ox + jitter(), y: oy + h + jitter() },
    ];
    let pos = 0;
    let neg = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % 4]!;
      const c = quad[(i + 2) % 4]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross > 0) pos++;
      else neg++;
    }
    if (pos === 4 || neg === 4) return quad;
  }
}

describe('solveLinear (own Gaussian elimination with partial pivoting)', () => {
  it('solves a known system exactly', () => {
    // 2x + y = 5; x + 3y − z = 4; −x + 2z = 3  →  x=2, y=1, z=2.5? check: −2+5=3 ✓
    const a = Float64Array.from([2, 1, 0, 1, 3, -1, -1, 0, 2]);
    const b = Float64Array.from([5, 4, 3]);
    const res = solveLinear(a, 3, b);
    expect(res).not.toBeNull();
    expect(res!.x[0]).toBeCloseTo(2, 12);
    expect(res!.x[1]).toBeCloseTo(1, 12);
    expect(res!.x[2]).toBeCloseTo(2.5, 12);
    expect(res!.minPivot).toBeGreaterThan(0);
    expect(res!.maxPivot).toBeGreaterThanOrEqual(res!.minPivot);
  });

  it('needs the partial pivot (zero on the diagonal) and still solves', () => {
    // First diagonal entry 0 forces a row swap.
    const a = Float64Array.from([0, 1, 1, 2]);
    const b = Float64Array.from([3, 4]);
    const res = solveLinear(a, 2, b);
    expect(res).not.toBeNull();
    // y = 3; x + 2y = 4 → x = −2.
    expect(res!.x[1]).toBeCloseTo(3, 12);
    expect(res!.x[0]).toBeCloseTo(-2, 12);
  });

  it('returns null on a singular system instead of garbage', () => {
    const a = Float64Array.from([1, 2, 2, 4]); // rank 1
    const b = Float64Array.from([1, 3]);
    expect(solveLinear(a, 2, b)).toBeNull();
  });

  it('property: A·x = b for seeded random well-conditioned systems', () => {
    const rand = mulberry32(606);
    for (let trial = 0; trial < 300; trial++) {
      const n = 3 + Math.floor(rand() * 6); // 3..8
      const a = new Float64Array(n * n);
      const b = new Float64Array(n);
      for (let i = 0; i < n * n; i++) a[i] = 4 * (rand() - 0.5);
      for (let i = 0; i < n; i++) {
        a[i * n + i] = a[i * n + i]! + (a[i * n + i]! >= 0 ? n : -n); // diagonal dominance
        b[i] = 4 * (rand() - 0.5);
      }
      const res = solveLinear(a, n, b);
      expect(res).not.toBeNull();
      for (let r = 0; r < n; r++) {
        let sum = 0;
        for (let c = 0; c < n; c++) sum += a[r * n + c]! * res!.x[c]!;
        expect(Math.abs(sum - b[r]!)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('homography: unit square → quad (normalized DLT)', () => {
  it('interpolates the four corners exactly and inverts cleanly, over 500 seeded quads', () => {
    const rand = mulberry32(707);
    let minCondition = Infinity;
    for (let trial = 0; trial < 500; trial++) {
      const quad = randomConvexQuad(rand);
      const res = homographyUnitSquareToQuad(quad);
      expect(res.ok, `trial ${trial} failed: ${res.ok ? '' : res.message}`).toBe(true);
      if (!res.ok) continue;
      minCondition = Math.min(minCondition, res.conditionProxy);
      const scale = Math.max(...quad.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
      for (let i = 0; i < 4; i++) {
        const mapped = applyHomography(res.h, UNIT_SQUARE[i]!);
        expect(mapped).not.toBeNull();
        expect(Math.abs(mapped!.x - quad[i]!.x)).toBeLessThan(1e-8 * (1 + scale));
        expect(Math.abs(mapped!.y - quad[i]!.y)).toBeLessThan(1e-8 * (1 + scale));
      }
      // Inverse maps the quad back onto the unit square corners.
      const hInv = mat3Inverse(res.h);
      expect(hInv).not.toBeNull();
      for (let i = 0; i < 4; i++) {
        const back = applyHomography(hInv!, quad[i]!);
        expect(back).not.toBeNull();
        expect(Math.abs(back!.x - UNIT_SQUARE[i]!.x)).toBeLessThan(1e-8);
        expect(Math.abs(back!.y - UNIT_SQUARE[i]!.y)).toBeLessThan(1e-8);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`homography min condition proxy over 500 random quads: ${minCondition.toExponential(2)}`);
  });

  it('preserves lines: the image of a source-edge midpoint lies on the image edge', () => {
    const rand = mulberry32(808);
    for (let trial = 0; trial < 200; trial++) {
      const quad = randomConvexQuad(rand);
      const res = homographyUnitSquareToQuad(quad);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      const mid = applyHomography(res.h, { x: 0.5, y: 0 }); // midpoint of P0→P1 source edge
      expect(mid).not.toBeNull();
      const a = quad[0]!;
      const b = quad[1]!;
      const cross = (b.x - a.x) * (mid!.y - a.y) - (b.y - a.y) * (mid!.x - a.x);
      const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
      expect(Math.abs(cross) / (edgeLen * edgeLen)).toBeLessThan(1e-9);
      const t = ((mid!.x - a.x) * (b.x - a.x) + (mid!.y - a.y) * (b.y - a.y)) / (edgeLen * edgeLen);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
  });

  it('maps an affine target as an affine map (bottom row [0,0,·])', () => {
    // Parallelogram target → affine homography → exact vanishing points at infinity.
    const quad: [Px, Px, Px, Px] = [
      { x: 100, y: 100 },
      { x: 400, y: 160 },
      { x: 470, y: 420 },
      { x: 170, y: 360 },
    ];
    const res = homographyUnitSquareToQuad(quad);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const mag = Math.max(...res.h.map((e) => Math.abs(e)));
    expect(Math.abs(res.h[6]) / mag).toBeLessThan(1e-12);
    expect(Math.abs(res.h[7]) / mag).toBeLessThan(1e-12);
  });

  it('reports failure on degenerate quads rather than returning garbage', () => {
    // Three exactly-collinear image points (the unit square's are not) — no
    // projective map can do this; the DLT system is singular.
    const collinear: [Px, Px, Px, Px] = [
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ];
    expect(homographyUnitSquareToQuad(collinear).ok).toBe(false);

    const coincident: [Px, Px, Px, Px] = [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 400 },
    ];
    expect(homographyUnitSquareToQuad(coincident).ok).toBe(false);

    const allSame: [Px, Px, Px, Px] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(homographyUnitSquareToQuad(allSame).ok).toBe(false);

    const nonFinite: [Px, Px, Px, Px] = [
      { x: NaN, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 400 },
    ];
    expect(homographyUnitSquareToQuad(nonFinite).ok).toBe(false);
  });

  it('degenerate source correspondences fail too', () => {
    const src: [Px, Px, Px, Px] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 }, // all collinear
    ];
    const dst: [Px, Px, Px, Px] = [
      { x: 100, y: 100 },
      { x: 400, y: 120 },
      { x: 420, y: 400 },
      { x: 90, y: 380 },
    ];
    expect(homographyFromCorrespondences(src, dst).ok).toBe(false);
  });

  it('applyHomography refuses points that map to infinity', () => {
    // H sends x = 1 to the line at infinity: bottom row (1, 0, −1).
    const h: Mat3 = [1, 0, 0, 0, 1, 0, 1, 0, -1];
    expect(applyHomography(h, { x: 1, y: 0.5 })).toBeNull();
    expect(applyHomography(h, { x: 0, y: 0.5 })).not.toBeNull();
  });
});

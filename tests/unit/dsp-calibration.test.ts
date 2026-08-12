/**
 * Ellipsoid calibration fit — SPEC §4.6.1, §10.1.
 * Synthesize sphere data, apply a known hard-iron offset + soft-iron
 * distortion + noise, verify recovery within tolerance. Property test over
 * 200 seeded random distortions. All randomness is mulberry32 — no
 * Math.random anywhere, every run identical.
 */
import { describe, expect, it } from 'vitest';
import { applyCalibration, fitEllipsoid, HARD_IRON_ACCESSORY_UT } from '../../src/dsp/calibration';
import { eigenSym3, mul3, solveLinear } from '../../src/dsp/linalg';
import { gaussian, mulberry32 } from '../../src/dsp/synth';
import type { Vec3 } from '../../src/types';

/** Deterministic well-spread directions: Fibonacci sphere. */
function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i) / (n - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    pts.push([r * Math.cos(th), y, r * Math.sin(th)]);
  }
  return pts;
}

/** Random symmetric positive-definite soft-iron matrix with eigenvalues in [lo, hi]. */
function randomSoftIron(rand: () => number, lo: number, hi: number): number[][] {
  // Random rotation via two Givens-style angles + eigenvalue scales.
  const a = rand() * 2 * Math.PI;
  const b = rand() * 2 * Math.PI;
  const c = rand() * 2 * Math.PI;
  const rz = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ];
  const ry = [
    [Math.cos(b), 0, Math.sin(b)],
    [0, 1, 0],
    [-Math.sin(b), 0, Math.cos(b)],
  ];
  const rx = [
    [1, 0, 0],
    [0, Math.cos(c), -Math.sin(c)],
    [0, Math.sin(c), Math.cos(c)],
  ];
  const q = mul3(mul3(rz, ry), rx);
  const scales = [lo + rand() * (hi - lo), lo + rand() * (hi - lo), lo + rand() * (hi - lo)];
  // A = Q diag(s) Qᵀ (symmetric PD)
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += q[i]![k]! * scales[k]! * q[j]![k]!;
      out[i]![j] = acc;
    }
  }
  return out;
}

function distort(
  sphere: readonly Vec3[],
  radius: number,
  soft: number[][],
  hard: Vec3,
  noise: number,
  gauss: () => number,
): Vec3[] {
  return sphere.map(([x, y, z]) => {
    const sx = radius * x;
    const sy = radius * y;
    const sz = radius * z;
    return [
      soft[0]![0]! * sx + soft[0]![1]! * sy + soft[0]![2]! * sz + hard[0] + noise * gauss(),
      soft[1]![0]! * sx + soft[1]![1]! * sy + soft[1]![2]! * sz + hard[1] + noise * gauss(),
      soft[2]![0]! * sx + soft[2]![1]! * sy + soft[2]![2]! * sz + hard[2] + noise * gauss(),
    ];
  });
}

describe('linalg helpers', () => {
  it('solveLinear solves a known system', () => {
    const x = solveLinear(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(2, 9);
    expect(x![1]).toBeCloseTo(3, 9);
    expect(x![2]).toBeCloseTo(-1, 9);
  });

  it('solveLinear reports singular systems as null', () => {
    expect(
      solveLinear(
        [
          [1, 2, 3],
          [2, 4, 6],
          [0, 0, 1],
        ],
        [1, 2, 1],
      ),
    ).toBeNull();
  });

  it('eigenSym3 recovers known eigenvalues of a symmetric matrix', () => {
    // diag(1,2,3) rotated is still {1,2,3}.
    const { values } = eigenSym3([
      [2, 1, 0],
      [1, 2, 0],
      [0, 0, 5],
    ]);
    const sorted = [...values].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(1, 9);
    expect(sorted[1]).toBeCloseTo(3, 9);
    expect(sorted[2]).toBeCloseTo(5, 9);
  });
});

describe('ellipsoid fit — known distortion recovery (SPEC §4.6.1)', () => {
  const R = 48; // ~Earth field magnitude, µT

  it('recovers a pure sphere: near-zero hard iron, near-identity soft iron', () => {
    const pts = fibonacciSphere(400).map(([x, y, z]) => [R * x, R * y, R * z] as Vec3);
    const fit = fitEllipsoid(pts);
    expect(fit.ok).toBe(true);
    expect(Math.hypot(...fit.hardIron)).toBeLessThan(1e-6);
    expect(fit.residual).toBeLessThan(1e-6);
    expect(fit.radius).toBeCloseTo(R, 6);
    expect(fit.coverage).toBe(1);
    // softIron ≈ identity
    const eye = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let i = 0; i < 9; i++) expect(fit.softIron[i]).toBeCloseTo(eye[i]!, 6);
  });

  it('recovers a known hard-iron offset + soft-iron distortion under noise', () => {
    const rand = mulberry32(12345);
    const gauss = gaussian(rand);
    const hard: Vec3 = [31.2, -18.4, 9.7];
    const soft = randomSoftIron(rand, 0.85, 1.2);
    const pts = distort(fibonacciSphere(500), R, soft, hard, 0.3, gauss);
    const fit = fitEllipsoid(pts);
    expect(fit.ok).toBe(true);
    expect(Math.abs(fit.hardIron[0] - hard[0])).toBeLessThan(0.5);
    expect(Math.abs(fit.hardIron[1] - hard[1])).toBeLessThan(0.5);
    expect(Math.abs(fit.hardIron[2] - hard[2])).toBeLessThan(0.5);
    // Corrected samples are spherical.
    expect(fit.residual).toBeLessThan(0.02);
    // The correction undoes the distortion: |W·A·u| constant for all u.
    const corrected = pts.map((p) => applyCalibration(fit, p));
    const mags = corrected.map((c) => Math.hypot(...c));
    const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
    for (const m of mags) expect(Math.abs(m - mean) / mean).toBeLessThan(0.05);
  });

  it('flags the case-magnet threshold constant at 40 µT (SPEC §4.6)', () => {
    expect(HARD_IRON_ACCESSORY_UT).toBe(40);
  });

  it('property: 200 seeded random distortions all recover within tolerance', () => {
    let worstHard = 0;
    let worstResidual = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rand = mulberry32(seed * 7919);
      const gauss = gaussian(rand);
      const hard: Vec3 = [
        (rand() - 0.5) * 60,
        (rand() - 0.5) * 60,
        (rand() - 0.5) * 60,
      ];
      const soft = randomSoftIron(rand, 0.8, 1.25);
      const pts = distort(fibonacciSphere(300), R, soft, hard, 0.25, gauss);
      const fit = fitEllipsoid(pts);
      expect(fit.ok).toBe(true);
      const hardErr = Math.hypot(
        fit.hardIron[0] - hard[0],
        fit.hardIron[1] - hard[1],
        fit.hardIron[2] - hard[2],
      );
      expect(hardErr, `seed ${seed}: hard-iron error ${hardErr.toFixed(3)} µT`).toBeLessThan(1.0);
      expect(fit.residual, `seed ${seed}: residual ${fit.residual.toFixed(4)}`).toBeLessThan(0.02);
      expect(fit.coverage).toBe(1);
      if (hardErr > worstHard) worstHard = hardErr;
      if (fit.residual > worstResidual) worstResidual = fit.residual;
    }
    // Documented in docs/accuracy-dsp.md — keep these prints honest.
    console.log(
      `calibration property test: worst hard-iron error ${worstHard.toFixed(3)} µT, ` +
        `worst sphericity residual ${(worstResidual * 100).toFixed(2)}% over 200 distortions`,
    );
  });

  it('refuses degenerate data instead of guessing (SPEC §15.3)', () => {
    // All samples in one plane: not an ellipsoid fit, must not return ok.
    const rand = mulberry32(99);
    const flat: Vec3[] = [];
    for (let i = 0; i < 200; i++) {
      const th = rand() * 2 * Math.PI;
      flat.push([48 * Math.cos(th), 48 * Math.sin(th), 0]);
    }
    const fit = fitEllipsoid(flat);
    expect(fit.ok).toBe(false);
    expect(fit.reason).toBeTruthy();
    expect(fit.reason).not.toMatch(/simply|just |easy/i); // BRAND.md voice
  });

  it('reports partial octant coverage on a half-space sweep', () => {
    const pts = fibonacciSphere(300)
      .filter(([, y]) => y > 0.05)
      .map(([x, y, z]) => [48 * x, 48 * y, 48 * z] as Vec3);
    const fit = fitEllipsoid(pts);
    // Whether or not the quadric closes, coverage must expose the gap.
    expect(fit.coverage).toBeLessThan(1);
  });
});

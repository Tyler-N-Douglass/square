/**
 * Monte Carlo uncertainty tests — SPEC §4.3.3, §10.1. Owned by A3.
 * Includes the calibration test the spec mandates: for known injected pixel
 * noise, the reported 5–95% band must contain the truth ~90% of the time
 * (asserted at coverage ∈ [82%, 98%] over 200 seeded trials).
 * Seeded randomness only — no Math.random.
 */
import { describe, expect, it } from 'vitest';
import type { Intrinsics, Px } from '../../src/geometry/angleSolver';
import {
  gaussianSampler,
  monteCarloCornerAngle,
  mulberry32,
  quantileSorted,
} from '../../src/geometry/montecarlo';

const K: Intrinsics = { fPx: 1100, cx: 960, cy: 540 };

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

function makeCamera(c: V3, target: V3, rollDeg: number) {
  const f = norm(sub(target, c));
  const r0 = norm(cross(f, [0, 1, 0]));
  const d0 = cross(f, r0);
  const phi = (rollDeg * Math.PI) / 180;
  const r: V3 = [
    r0[0] * Math.cos(phi) + d0[0] * Math.sin(phi),
    r0[1] * Math.cos(phi) + d0[1] * Math.sin(phi),
    r0[2] * Math.cos(phi) + d0[2] * Math.sin(phi),
  ];
  const d: V3 = [
    -r0[0] * Math.sin(phi) + d0[0] * Math.cos(phi),
    -r0[1] * Math.sin(phi) + d0[1] * Math.cos(phi),
    -r0[2] * Math.sin(phi) + d0[2] * Math.cos(phi),
  ];
  return (p: V3): Px => {
    const w = sub(p, c);
    const z = dot(f, w);
    if (z <= 0.1) throw new Error('point behind camera — bad test setup');
    return { x: K.fPx * (dot(r, w) / z) + K.cx, y: K.fPx * (dot(d, w) / z) + K.cy };
  };
}

function makeQuad(thetaDeg: number): [V3, V3, V3, V3] {
  const th = (thetaDeg * Math.PI) / 180;
  const p1: V3 = [30, 0, 0];
  const p3: V3 = [20 * Math.cos(th), 20 * Math.sin(th), 0];
  return [[0, 0, 0], p1, [p1[0] + p3[0], p1[1] + p3[1], 0], p3];
}

function projectQuad(thetaDeg: number, c: V3, roll: number): [Px, Px, Px, Px] {
  const project = makeCamera(c, [15, 8, 0], roll);
  return makeQuad(thetaDeg).map(project) as [Px, Px, Px, Px];
}

describe('seeded PRNG + Box–Muller (SPEC §4.3.3 determinism)', () => {
  it('mulberry32 is deterministic and uniform-ish in [0,1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const va = a();
      expect(va).toBe(b());
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
      sum += va;
    }
    expect(sum / 10_000).toBeGreaterThan(0.48);
    expect(sum / 10_000).toBeLessThan(0.52);
    // Different seed, different stream.
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('gaussianSampler has ~N(0,1) moments over 20k seeded draws', () => {
    const gauss = gaussianSampler(mulberry32(4321));
    const n = 20_000;
    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < n; i++) {
      const g = gauss();
      mean += g;
      m2 += g * g;
    }
    mean /= n;
    const variance = m2 / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(variance - 1)).toBeLessThan(0.03);
  });

  it('quantileSorted interpolates linearly', () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(quantileSorted([0, 10], 0.25)).toBeCloseTo(2.5, 12);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });
});

describe('monteCarloCornerAngle (SPEC §4.3.3)', () => {
  const quad = projectQuad(90, [15, 8, 60], 12);

  it('is bit-identical for the same seed and differs across seeds', () => {
    const a = monteCarloCornerAngle(quad, K, { samples: 200, seed: 99 });
    const b = monteCarloCornerAngle(quad, K, { samples: 200, seed: 99 });
    expect(a).toEqual(b);
    const c = monteCarloCornerAngle(quad, K, { samples: 200, seed: 100 });
    expect(a.ok && c.ok && a.medianDeg === c.medianDeg).toBe(false);
  });

  it('σ = 0 collapses to the point solve with zero width', () => {
    const res = monteCarloCornerAngle(quad, K, { sigmaPx: 0, samples: 50 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.halfWidthDeg).toBe(0);
      expect(res.medianDeg).toBeCloseTo(res.pointDeg, 9);
      expect(Math.abs(res.medianDeg - 90)).toBeLessThan(1e-6);
      expect(res.samplesUsed).toBe(50);
      expect(res.samplesRefused).toBe(0);
    }
  });

  it('the reported width grows with the injected noise', () => {
    const narrow = monteCarloCornerAngle(quad, K, { sigmaPx: 1, samples: 400, seed: 5 });
    const wide = monteCarloCornerAngle(quad, K, { sigmaPx: 3, samples: 400, seed: 5 });
    expect(narrow.ok && wide.ok).toBe(true);
    if (narrow.ok && wide.ok) {
      expect(narrow.halfWidthDeg).toBeGreaterThan(0);
      const ratio = wide.halfWidthDeg / narrow.halfWidthDeg;
      // Locally linear propagation: tripling σ roughly triples the width.
      expect(ratio).toBeGreaterThan(1.8);
      expect(ratio).toBeLessThan(5);
    }
  });

  it('refuses when the base geometry refuses', () => {
    const collinear: [Px, Px, Px, Px] = [
      { x: 100, y: 500 },
      { x: 700, y: 502 },
      { x: 1300, y: 504 },
      { x: 1720, y: 505.5 },
    ];
    const res = monteCarloCornerAngle(collinear, K);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('POOR_GEOMETRY');
  });

  it('refuses fragile geometry where perturbations collapse (biased survivors)', () => {
    // A 12 px quad under σ = 6 px: most perturbations are degenerate.
    const tiny: [Px, Px, Px, Px] = [
      { x: 100, y: 100 },
      { x: 112, y: 100 },
      { x: 112, y: 112 },
      { x: 100, y: 112 },
    ];
    const res = monteCarloCornerAngle(tiny, K, { sigmaPx: 6, samples: 200, seed: 11 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('POOR_GEOMETRY');
      expect(res.message).toMatch(/fragile/);
    }
  });

  it('rejects nonsense options', () => {
    expect(monteCarloCornerAngle(quad, K, { sigmaPx: -1 }).ok).toBe(false);
    expect(monteCarloCornerAngle(quad, K, { sigmaPx: NaN }).ok).toBe(false);
    expect(monteCarloCornerAngle(quad, K, { samples: 3 }).ok).toBe(false);
    expect(monteCarloCornerAngle(quad, K, { samples: 100.5 }).ok).toBe(false);
  });

  it(
    'CALIBRATION (SPEC §10.1): the 5–95% band contains the truth ~90% of the time under 2 px noise',
    { timeout: 60_000 },
    () => {
      const configs: Array<{ theta: number; c: V3; roll: number }> = [
        { theta: 90, c: [15, 8, 60], roll: 12 },
        { theta: 104, c: [-10, 20, 55], roll: -8 },
      ];
      const sigma = 2;
      const trialsPerConfig = 100;
      let covered = 0;
      let total = 0;
      for (const cfg of configs) {
        const clean = projectQuad(cfg.theta, cfg.c, cfg.roll);
        for (let t = 0; t < trialsPerConfig; t++) {
          // The "user's marking" for this trial: truth + 2 px seeded noise.
          const gauss = gaussianSampler(mulberry32(7000 + t + (cfg.theta << 8)));
          const marked = clean.map((p) => ({
            x: p.x + sigma * gauss(),
            y: p.y + sigma * gauss(),
          })) as [Px, Px, Px, Px];
          const res = monteCarloCornerAngle(marked, K, {
            sigmaPx: sigma,
            samples: 500, // the shipped default (SPEC §4.3.3)
            seed: 100 + t,
          });
          expect(res.ok).toBe(true);
          if (!res.ok) continue;
          total++;
          if (
            cfg.theta >= res.medianDeg - res.halfWidthDeg &&
            cfg.theta <= res.medianDeg + res.halfWidthDeg
          ) {
            covered++;
          }
        }
      }
      const coverage = covered / total;
      // eslint-disable-next-line no-console
      console.log(`monte carlo coverage: ${covered}/${total} = ${(100 * coverage).toFixed(1)}% (nominal 90%)`);
      expect(coverage).toBeGreaterThanOrEqual(0.82);
      expect(coverage).toBeLessThanOrEqual(0.98);
    },
  );
});

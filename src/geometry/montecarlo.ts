/**
 * Monte Carlo uncertainty for the photo corner angle — SPEC §4.3.3.
 * Owned by A3 (Geometry/Vision). Tested in tests/unit/geometry-montecarlo.test.ts
 * (including the §10.1 coverage-calibration test: the reported band must
 * contain the truth ~90% of the time for known injected pixel noise).
 *
 * Procedure: perturb every marked corner with Gaussian noise (default
 * σ = 2 px — SPEC's marking-error model; callers scale it with zoom and
 * resolution), re-run the full solver N = 500 times, report the median and
 * the half-width of the 5–95% interval. Displayed as `88.4° ± 0.6°` with
 * basis 'montecarlo' (src/types.ts Measurement.uncertainty).
 *
 * Determinism: all randomness flows from mulberry32(seed) through Box–Muller.
 * Same seed, same inputs → bit-identical output. No Math.random anywhere.
 *
 * Honesty: if the base quad refuses, the result refuses. If more than
 * maxRefusalFraction of the perturbed samples refuse, the geometry is so
 * close to degenerate that the surviving samples are a biased subset — the
 * result refuses rather than reporting a cheerful narrow band (SPEC §15.3).
 */
import { cornerAngleFromQuad, type Intrinsics, type Px, type QuadAngleResult } from './angleSolver';

/**
 * mulberry32 — tiny 32-bit seeded PRNG, uniform in [0, 1).
 * Deterministic across platforms (integer ops + imul only).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard-normal sampler over a uniform source (Box–Muller, both branches
 * used, spare cached). Deterministic given a deterministic source.
 */
export function gaussianSampler(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    do {
      u = rand();
    } while (u <= Number.MIN_VALUE); // log(0) guard
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * rand();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

/** Quantile with linear interpolation over an ascending-sorted array. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export interface MonteCarloOptions {
  /** Gaussian σ applied to each corner coordinate, px. Default 2 (SPEC §4.3.3). */
  sigmaPx?: number;
  /** Number of perturbed re-solves. Default 500 (SPEC §4.3.3). */
  samples?: number;
  /** PRNG seed; same seed → identical result. Default 0x5eed. */
  seed?: number;
  /** Refuse when more than this fraction of samples refuse. Default 0.25. */
  maxRefusalFraction?: number;
}

export type MonteCarloAngleResult =
  | {
      ok: true;
      /** Median recovered angle, degrees. */
      medianDeg: number;
      /** Half-width of the 5–95% interval — the displayed ±, degrees. */
      halfWidthDeg: number;
      p5Deg: number;
      p95Deg: number;
      /** Point solve of the unperturbed quad, degrees. */
      pointDeg: number;
      samplesUsed: number;
      samplesRefused: number;
      sigmaPx: number;
    }
  | { ok: false; reason: 'POOR_GEOMETRY'; message: string };

export function monteCarloCornerAngle(
  quad: [Px, Px, Px, Px],
  k: Intrinsics,
  options: MonteCarloOptions = {},
): MonteCarloAngleResult {
  const sigmaPx = options.sigmaPx ?? 2;
  const samples = options.samples ?? 500;
  const seed = options.seed ?? 0x5eed;
  const maxRefusalFraction = options.maxRefusalFraction ?? 0.25;
  if (!(sigmaPx >= 0) || !Number.isFinite(sigmaPx)) {
    return { ok: false, reason: 'POOR_GEOMETRY', message: 'sigmaPx must be a non-negative number' };
  }
  if (!Number.isInteger(samples) || samples < 10) {
    return { ok: false, reason: 'POOR_GEOMETRY', message: 'samples must be an integer ≥ 10' };
  }

  const base: QuadAngleResult = cornerAngleFromQuad(quad, k);
  if (!base.ok) return base;

  const gauss = gaussianSampler(mulberry32(seed));
  const thetas: number[] = [];
  let refused = 0;
  for (let i = 0; i < samples; i++) {
    const perturbed = quad.map((p) => ({
      x: p.x + sigmaPx * gauss(),
      y: p.y + sigmaPx * gauss(),
    })) as [Px, Px, Px, Px];
    const res = cornerAngleFromQuad(perturbed, k);
    if (res.ok) thetas.push(res.thetaDeg);
    else refused++;
  }

  if (refused / samples > maxRefusalFraction) {
    return {
      ok: false,
      reason: 'POOR_GEOMETRY',
      message: `geometry is fragile under ${sigmaPx} px noise (${refused}/${samples} refusals) — re-mark with the loupe or move back`,
    };
  }

  thetas.sort((a, b) => a - b);
  const p5 = quantileSorted(thetas, 0.05);
  const p95 = quantileSorted(thetas, 0.95);
  return {
    ok: true,
    medianDeg: quantileSorted(thetas, 0.5),
    halfWidthDeg: (p95 - p5) / 2,
    p5Deg: p5,
    p95Deg: p95,
    pointDeg: base.thetaDeg,
    samplesUsed: thetas.length,
    samplesRefused: refused,
    sigmaPx,
  };
}

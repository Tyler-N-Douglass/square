/**
 * Filtering primitives — SPEC §4.1.2 steps 3–5.
 */
import { describe, expect, it } from 'vitest';
import {
  detrend,
  mad,
  median,
  movingMedian,
  noiseSigmaTrailing,
  rms,
  robustSigma,
  savitzkyGolay,
  savitzkyGolayCoeffs,
} from '../../src/dsp/filters';
import { gaussian, mulberry32 } from '../../src/dsp/synth';

describe('median / MAD', () => {
  it('median of odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
  it('MAD is robust to a 40% outlier fraction', () => {
    const base = [1, 1, 1, 1, 1, 1, 100, 100, 100, 100];
    expect(mad(base)).toBe(0);
  });
  it('robustSigma matches stddev for Gaussian noise within 10%', () => {
    const gauss = gaussian(mulberry32(7));
    const xs = Array.from({ length: 5000 }, () => 2.5 * gauss());
    expect(robustSigma(xs)).toBeGreaterThan(2.25);
    expect(robustSigma(xs)).toBeLessThan(2.75);
  });
  it('robustSigma is floored — a constant signal cannot divide by zero', () => {
    expect(robustSigma([5, 5, 5, 5])).toBe(1e-3);
  });
});

describe('movingMedian / detrend (step 3)', () => {
  it('rejects even windows', () => {
    expect(() => movingMedian([1, 2, 3], 4)).toThrow(/odd/);
  });
  it('removes a linear drift while passing a short bipolar wiggle', () => {
    const hz = 40;
    const n = 320;
    const sig: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / hz;
      const drift = 48 + 0.5 * t; // slow pedestal drift
      const u = (t - 4) / 0.33;
      const wiggle = -u * Math.exp(-0.5 * u * u) * 3;
      sig.push(drift + wiggle);
    }
    const out = detrend(sig, hz, 2.0);
    // Far from the wiggle: residual near zero (drift removed).
    expect(Math.abs(out[40]!)).toBeLessThan(0.15);
    expect(Math.abs(out[280]!)).toBeLessThan(0.15);
    // At the lobes: wiggle survives detrending.
    const maxAbs = Math.max(...out.map(Math.abs));
    expect(maxAbs).toBeGreaterThan(2.0);
  });
  it('removes a constant pedestal exactly and preserves a short pulse', () => {
    const hz = 40;
    const n = 320;
    // 48 µT pedestal with a 0.4 s pulse (16 samples ≪ half the 81-sample window).
    const sig = Array.from({ length: n }, (_, i) => 48 + (i >= 150 && i < 166 ? 5 : 0));
    const out = detrend(sig, hz, 2.0);
    expect(out[40]).toBeCloseTo(0, 9); // pedestal gone
    expect(out[157]).toBeCloseTo(5, 9); // pulse intact — median ignores a <50% excursion
  });
});

describe('Savitzky-Golay (step 4)', () => {
  it('closed-form window-9 order-2 coefficients are [-21,14,39,54,59,54,39,14,-21]/231', () => {
    const c = savitzkyGolayCoeffs(4);
    const expected = [-21, 14, 39, 54, 59, 54, 39, 14, -21].map((v) => v / 231);
    for (let i = 0; i < 9; i++) expect(c[i]).toBeCloseTo(expected[i]!, 12);
  });
  it('coefficients sum to 1 for any window (DC preserved)', () => {
    for (const m of [2, 3, 4, 5, 8]) {
      const sum = savitzkyGolayCoeffs(m).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });
  it('reproduces a quadratic exactly (order-2 fit is exact on order-2 signals)', () => {
    const sig = Array.from({ length: 50 }, (_, i) => 0.02 * i * i - 0.3 * i + 7);
    const out = savitzkyGolay(sig, 9);
    // Interior points: exact. (Edges use reflection, which breaks the polynomial.)
    for (let i = 4; i < 46; i++) expect(out[i]).toBeCloseTo(sig[i]!, 9);
  });
  it('attenuates white noise by ~√(Σc²) ≈ 0.505 for window 9', () => {
    const gauss = gaussian(mulberry32(21));
    const sig = Array.from({ length: 8000 }, () => gauss());
    const out = savitzkyGolay(sig, 9);
    const ratio = rms(out) / rms(sig);
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.56);
  });
  it('does not shift a symmetric peak (zero phase)', () => {
    const sig = Array.from({ length: 81 }, (_, i) => Math.exp(-((i - 40) ** 2) / 50));
    const out = savitzkyGolay(sig, 9);
    const argmax = out.indexOf(Math.max(...out));
    expect(argmax).toBe(40);
  });
});

describe('noise floor (step 5)', () => {
  it('trailing σ tracks a noise step upward', () => {
    const gauss = gaussian(mulberry32(3));
    const hz = 40;
    const sig: number[] = [];
    for (let i = 0; i < 480; i++) sig.push((i < 240 ? 0.1 : 1.0) * gauss());
    const sigma = noiseSigmaTrailing(sig, hz, 3.0);
    expect(sigma[200]!).toBeLessThan(0.2);
    expect(sigma[470]!).toBeGreaterThan(0.6);
  });
  it('is defined and finite from sample zero', () => {
    const sigma = noiseSigmaTrailing([1, 2, 1, 3, 1, 2, 1, 3, 1, 2], 40, 3.0);
    for (const s of sigma) expect(Number.isFinite(s)).toBe(true);
  });
});

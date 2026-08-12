/**
 * Bipolar peak detection — SPEC §4.1.2 steps 6/6b.
 * The synthetic ground truth here is the same derivative-of-Gaussian physics
 * as the fixture corpus; positions are exact by construction.
 */
import { describe, expect, it } from 'vitest';
import { robustSigma, savitzkyGolay } from '../../src/dsp/filters';
import {
  detectBipolarEvents,
  findLobes,
  localMaxima,
  peakProminence,
  type BipolarEvent,
} from '../../src/dsp/peaks';
import { dogSignature, gaussian, mulberry32 } from '../../src/dsp/synth';

function dogSignal(n: number, centers: number[], amp: number, lobeSamples: number, noise = 0, seed = 1): number[] {
  const gauss = gaussian(mulberry32(seed));
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (const c of centers) out[i]! += amp * dogSignature(i, c, lobeSamples);
    if (noise > 0) out[i]! += noise * gauss();
  }
  return out;
}

/**
 * Mirror of the pipeline's steps 4–6 for a noisy signal: band-limit first,
 * then measure σ off the filtered signal — the detector never sees raw
 * white noise in the real chain.
 */
function detectLikePipeline(
  sig: number[],
  overrides: Partial<{ maxPairGap: number; minSeparation: number; kSigma: number }> = {},
): { events: BipolarEvent[]; filtered: number[]; sigma: number } {
  const filtered = savitzkyGolay(sig, 9);
  const sigma = robustSigma(filtered);
  const events = detectBipolarEvents(filtered, {
    sigma,
    maxPairGap: overrides.maxPairGap ?? 45,
    minSeparation: overrides.minSeparation ?? 26,
    kSigma: overrides.kSigma ?? 3.5,
  });
  return { events, filtered, sigma };
}

describe('localMaxima / peakProminence', () => {
  it('finds interior maxima only', () => {
    expect(localMaxima([0, 2, 0, 3, 0])).toEqual([1, 3]);
    expect(localMaxima([5, 1, 1, 1, 9])).toEqual([]);
  });
  it('prominence of an isolated peak is its height above the floor', () => {
    const sig = [0, 0, 5, 0, 0];
    expect(peakProminence(sig, 2)).toBe(5);
  });
  it('prominence respects the key saddle between two peaks', () => {
    //          0  8  3  10  0 — smaller peak's prominence is 8−3=5
    const sig = [0, 8, 3, 10, 0];
    expect(peakProminence(sig, 1)).toBe(5);
    expect(peakProminence(sig, 3)).toBe(10);
  });
});

describe('bipolar event detection (step 6)', () => {
  it('detects a clean bipolar signature and rejects nothing real', () => {
    const sig = dogSignal(200, [100], 5, 13, 0.1);
    const { events } = detectLikePipeline(sig);
    expect(events).toHaveLength(1);
    expect(Math.abs(events[0]!.zeroCrossIndex - 100)).toBeLessThan(2);
    expect(events[0]!.snr).toBeGreaterThan(8);
  });

  it('REJECTS a one-sided bump — the bipolar-shape test (drift artifact)', () => {
    // A single positive Gaussian bump: prominent, but no opposite lobe.
    const sig = Array.from({ length: 200 }, (_, i) => 5 * Math.exp(-((i - 100) ** 2) / (2 * 13 ** 2)));
    const events = detectBipolarEvents(sig, { sigma: 0.1, maxPairGap: 45, minSeparation: 26 });
    expect(events).toHaveLength(0);
  });

  it('a tiny opposite ripple cannot steal a real lobe pairing', () => {
    // Two fasteners: full bipolar pairs must win over cross-pairing.
    const sig = dogSignal(400, [120, 280], 5, 13, 0.08, 5);
    const events = detectBipolarEvents(sig, { sigma: 0.08, maxPairGap: 45, minSeparation: 26 });
    expect(events).toHaveLength(2);
    expect(Math.abs(events[0]!.zeroCrossIndex - 120)).toBeLessThan(3);
    expect(Math.abs(events[1]!.zeroCrossIndex - 280)).toBeLessThan(3);
  });

  it('zero crossing lands at the fastener; amplitude extremum lands one lobe-sigma off (step 6b)', () => {
    const lobe = 13;
    const sig = dogSignal(300, [150], 5, lobe, 0.05, 9);
    const events = detectBipolarEvents(sig, { sigma: 0.05, maxPairGap: 45, minSeparation: 26 });
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(Math.abs(ev.zeroCrossIndex - 150)).toBeLessThan(2);
    // The extremum sits ±one lobe-sigma from the crossing — provably wrong as a position.
    expect(Math.abs(ev.amplitudeIndex - 150)).toBeGreaterThan(lobe * 0.6);
    expect(Math.abs(ev.amplitudeIndex - 150)).toBeLessThan(lobe * 1.6);
  });

  it('respects polarity: a flipped signature (−then+) still resolves', () => {
    const sig = dogSignal(200, [100], -4, 13, 0.05, 11);
    const events = detectBipolarEvents(sig, { sigma: 0.05, maxPairGap: 45, minSeparation: 26 });
    expect(events).toHaveLength(1);
    expect(Math.abs(events[0]!.zeroCrossIndex - 100)).toBeLessThan(2);
  });

  it('minimum separation keeps the stronger of two colliding events', () => {
    const a = dogSignal(200, [90], 3, 10);
    const b = dogSignal(200, [105], 6, 10);
    const sig = a.map((v, i) => v + b[i]!);
    const events = detectBipolarEvents(sig, { sigma: 0.05, maxPairGap: 30, minSeparation: 40 });
    expect(events).toHaveLength(1);
    // The kept event is the stronger one, near 105.
    expect(Math.abs(events[0]!.zeroCrossIndex - 105)).toBeLessThan(8);
  });

  it('below-threshold noise produces no events at k=3.5', () => {
    const gauss = gaussian(mulberry32(31));
    const sig = Array.from({ length: 400 }, () => 0.1 * gauss());
    const events = detectBipolarEvents(sig, { sigma: 0.1, maxPairGap: 45, minSeparation: 26 });
    expect(events).toHaveLength(0);
  });

  it('findLobes returns both signs sorted by index', () => {
    const sig = dogSignal(200, [100], 5, 13);
    const lobes = findLobes(sig, 1);
    expect(lobes.length).toBeGreaterThanOrEqual(2);
    const signs = lobes.map((l) => l.sign);
    expect(signs).toContain(1);
    expect(signs).toContain(-1);
    for (let i = 1; i < lobes.length; i++) {
      expect(lobes[i]!.index).toBeGreaterThan(lobes[i - 1]!.index);
    }
  });
});

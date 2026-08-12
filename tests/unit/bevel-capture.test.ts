/**
 * BEVEL gravity capture — SPEC §4.5.1 (A4, Phase 2).
 *
 * The horizontal-edge identity is verified HERE, independently of the
 * implementation: gravity pairs are constructed in the test with its own
 * rotation math, at level and tilted fold axes, and the test checks both
 * that acos(ĝ₁·ĝ₂) equals the fold angle when the edge is level and that it
 * is provably WRONG when tilted — which is why the tool must refuse, not
 * warn.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_WINDOW_MS,
  EDGE_TOL_MS2,
  G_MS2,
  GravityCapture,
  bladeTiltFromDihedralDeg,
  confidenceForStddev,
  dihedralFromCaptures,
  type FaceCapture,
} from '../../src/tools/bevel/capture';
import { foldStream, gravityOnFace, syntheticImuStream } from '../../src/tools/bevel/synthetic';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Independent construction: gravity on a face whose fold edge (device y)
 *  is tilted tau out of horizontal, fold phase alpha (degrees). */
function gVec(tauDeg: number, alphaDeg: number): [number, number, number] {
  const tau = tauDeg * RAD;
  const a = alphaDeg * RAD;
  return [G_MS2 * Math.cos(tau) * Math.sin(a), G_MS2 * Math.sin(tau), G_MS2 * Math.cos(tau) * Math.cos(a)];
}

function cap(g: [number, number, number], stddevDeg = 0.1): FaceCapture {
  const m = Math.hypot(g[0], g[1], g[2]);
  return {
    g,
    ghat: [g[0] / m, g[1] / m, g[2] / m],
    stddevDeg,
    edgeMs2: Math.abs(g[1]),
    sampleCount: 30,
    t: 0,
  };
}

describe('the dihedral identity θ = acos(ĝ₁·ĝ₂) — verified in the test itself', () => {
  it('recovers the fold angle exactly when the fold edge is level (τ = 0)', () => {
    for (const phi of [15, 30, 45, 90, 120, 135, 170]) {
      for (const alpha of [0, 20, 63, -40]) {
        const r = dihedralFromCaptures(cap(gVec(0, alpha)), cap(gVec(0, alpha - phi)));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.thetaDeg).toBeCloseTo(phi, 9);
      }
    }
  });

  it('the identity is provably biased on a tilted edge: ĝ₁·ĝ₂ = sin²τ + cos²τ·cos φ', () => {
    // Test-side derivation check, no product code involved: for a fold about
    // a tilted edge, the naive acos returns acos(sin²τ + cos²τ cos φ) ≠ φ.
    const tau = 20;
    const phi = 90;
    const g1 = gVec(tau, 10);
    const g2 = gVec(tau, 10 - phi);
    const dot =
      (g1[0] * g2[0] + g1[1] * g2[1] + g1[2] * g2[2]) /
      (Math.hypot(...g1) * Math.hypot(...g2));
    const predicted = Math.sin(tau * RAD) ** 2 + Math.cos(tau * RAD) ** 2 * Math.cos(phi * RAD);
    expect(dot).toBeCloseTo(predicted, 12);
    const naive = Math.acos(dot) * DEG;
    // At τ=20°, a true 90° fold reads ~83.3° — a wrong number, not a noisy one.
    expect(Math.abs(naive - phi)).toBeGreaterThan(5);
  });

  it('REFUSES a tilted edge (|g_edge| ≥ 0.8 m/s²) and never emits the angle', () => {
    for (const tau of [5, 10, 20, 45]) {
      const g1 = gVec(tau, 0);
      const g2 = gVec(tau, -135);
      expect(Math.abs(g1[1])).toBeGreaterThanOrEqual(EDGE_TOL_MS2); // τ=5° → 0.85 m/s²
      const r = dihedralFromCaptures(cap(g1), cap(g2));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain('Joint edge is not level');
        expect(r.reason).toContain('level');
        // The refusal states the edge reading, never the (invalid) dihedral.
        expect(r.reason).not.toMatch(/13[0-9](\.\d)?\s*°/);
      }
    }
  });

  it('accepts a slightly tilted edge under the threshold, with small bias', () => {
    const tau = 2; // g_y = 0.34 m/s² < 0.8
    const r = dihedralFromCaptures(cap(gVec(tau, 0)), cap(gVec(tau, -90)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.thetaDeg - 90)).toBeLessThan(0.25);
  });

  it('refuses when EITHER capture violates the edge condition', () => {
    const level = cap(gVec(0, 0));
    const tilted = cap(gVec(20, -90));
    expect(dihedralFromCaptures(level, tilted).ok).toBe(false);
    expect(dihedralFromCaptures(tilted, level).ok).toBe(false);
  });

  it('propagates window scatter: ± = √(σ₁²+σ₂²), floored at 0.1°', () => {
    const a = cap(gVec(0, 0), 0.3);
    const b = cap(gVec(0, -45), 0.4);
    const r = dihedralFromCaptures(a, b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plusMinusDeg).toBeCloseTo(0.5, 9);
    const exact = dihedralFromCaptures(cap(gVec(0, 0), 0), cap(gVec(0, -45), 0));
    if (exact.ok) expect(exact.plusMinusDeg).toBe(0.1);
  });
});

describe('GravityCapture state machine — stillness, window, averaging, stddev', () => {
  it('sits idle until armed, then captures after fusion-stable + 500 ms window', () => {
    const machine = new GravityCapture();
    const stream = foldStream({ foldDeg: 0, holdS: 1.4, transitS: 0.1, seed: 3 });
    // not armed: nothing happens
    const first = stream[0]!;
    expect(machine.ingest(first).phase).toBe('idle');
    machine.arm();
    let capturedAt: number | null = null;
    for (const s of stream) {
      const phase = machine.ingest(s);
      if (phase.phase === 'captured' && capturedAt === null) capturedAt = s.t;
    }
    expect(capturedAt).not.toBeNull();
    // 400 ms fusion gate + 500 ms window ≈ 0.9 s of stillness
    expect(capturedAt!).toBeGreaterThan(0.85);
    expect(capturedAt!).toBeLessThan(1.3);
  });

  it('averages the window and reports its angular scatter as the uncertainty', () => {
    const machine = new GravityCapture();
    machine.arm();
    const stream = syntheticImuStream({ g0: gravityOnFace(0, 30), segments: [{ kind: 'still', s: 1.4 }], seed: 5 });
    let captured: FaceCapture | null = null;
    for (const s of stream) {
      const phase = machine.ingest(s);
      if (phase.phase === 'captured') captured = phase.capture;
    }
    expect(captured).not.toBeNull();
    const c = captured!;
    const expected = gravityOnFace(0, 30);
    expect(c.g[0]).toBeCloseTo(expected[0], 1);
    expect(c.g[1]).toBeCloseTo(expected[1], 1);
    expect(c.g[2]).toBeCloseTo(expected[2], 1);
    expect(c.stddevDeg).toBeGreaterThan(0); // noise present → honest nonzero scatter
    expect(c.stddevDeg).toBeLessThan(0.5);
    // window is the CAPTURE_WINDOW_MS span at 60 Hz
    expect(c.sampleCount).toBeGreaterThanOrEqual(Math.floor((CAPTURE_WINDOW_MS / 1000) * 60));
    expect(c.sampleCount).toBeLessThanOrEqual(Math.ceil((CAPTURE_WINDOW_MS / 1000) * 60) + 3);
    expect(c.edgeMs2).toBeLessThan(0.1);
  });

  it('motion during settling resets the window — no capture through a wiggle', () => {
    const machine = new GravityCapture();
    machine.arm();
    const stream = syntheticImuStream({
      g0: gravityOnFace(0, 0),
      seed: 9,
      segments: [
        { kind: 'still', s: 0.6 },   // not enough: gate 0.4 + window 0.5
        { kind: 'shake', s: 0.4 },
        { kind: 'still', s: 1.4 },
      ],
    });
    let captureT: number | null = null;
    for (const s of stream) {
      const phase = machine.ingest(s);
      if (phase.phase === 'captured' && captureT === null) captureT = s.t;
    }
    expect(captureT).not.toBeNull();
    expect(captureT!).toBeGreaterThan(1.0 + 0.85); // only inside the second still block
  });

  it('end-to-end through the real pipeline: two captures of a 135° fold agree with the identity', () => {
    const machine = new GravityCapture();
    machine.arm();
    let c1: FaceCapture | null = null;
    let c2: FaceCapture | null = null;
    for (const s of foldStream({ foldDeg: 135, seed: 7 })) {
      const phase = machine.ingest(s);
      if (phase.phase === 'captured') {
        if (c1 === null) {
          c1 = phase.capture;
          machine.reset();
          machine.arm();
        } else if (c2 === null && phase.capture !== c1) {
          c2 = phase.capture;
        }
      }
    }
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    const r = dihedralFromCaptures(c1!, c2!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.thetaDeg).toBeCloseTo(135, 0);
      expect(Math.abs(r.thetaDeg - 135)).toBeLessThan(0.5);
    }
  });
});

describe('derived helpers', () => {
  it('blade tilt to reproduce a face on flat stock is |θ − 90|', () => {
    expect(bladeTiltFromDihedralDeg(135)).toBeCloseTo(45, 9);
    expect(bladeTiltFromDihedralDeg(90)).toBeCloseTo(0, 9);
    expect(bladeTiltFromDihedralDeg(67.5)).toBeCloseTo(22.5, 9);
  });

  it('confidence mapping is the documented one', () => {
    expect(confidenceForStddev(0.2)).toBe('STRONG');
    expect(confidenceForStddev(0.8)).toBe('LIKELY');
    expect(confidenceForStddev(2)).toBe('POSSIBLE');
  });
});

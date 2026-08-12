/**
 * LEVEL state logic (src/tools/level/levelState.ts): claim discipline
 * (±0.5° → ±0.15° only after reversal, stale suggests), the zero session,
 * the hold window, the save uncertainty floor, and the reversal state
 * machine (bias recovered, applied, cleared).
 */
import { describe, expect, it } from 'vitest';
import type { CalibrationProfile } from '../../src/types';
import { removeBias } from '../../src/geometry/levelMath';
import {
  buildSaveMeasurement,
  CLAIM_CALIBRATED_DEG,
  CLAIM_UNCALIBRATED_DEG,
  claimFor,
  confidenceFor,
  displayMeasurement,
  HoldWindow,
  LevelSession,
  MIN_HOLD_SAMPLES,
  ReversalMachine,
  uncertaintyForSave,
} from '../../src/tools/level/levelState';

const DAY = 24 * 60 * 60 * 1000;

function profile(over: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return { deviceKey: 'test', updatedAt: 0, ...over };
}

/* ---------------- claim discipline ---------------- */

describe('claimFor — the claim tightens only after reversal', () => {
  it('uncalibrated: ±0.5°, text says the calibration has not run', () => {
    const c = claimFor(profile());
    expect(c.plusMinus).toBe(CLAIM_UNCALIBRATED_DEG);
    expect(c.calibrated).toBe(false);
    expect(c.stale).toBe(false);
    expect(c.text).toContain('±0.5°');
    expect(c.text).toContain('not run');
  });

  it('calibrated today: ±0.15°, fresh', () => {
    const now = Date.now();
    const c = claimFor(profile({ levelBias: { pitch: 0.2, roll: -0.1 }, updatedAt: now }), now);
    expect(c.plusMinus).toBe(CLAIM_CALIBRATED_DEG);
    expect(c.calibrated).toBe(true);
    expect(c.stale).toBe(false);
    expect(c.ageDays).toBe(0);
    expect(c.text).toContain('±0.15°');
  });

  it('older than 30 days: still ±0.15° but stale, routes to recalibration — suggested, never blocked', () => {
    const now = Date.now();
    const c = claimFor(profile({ levelBias: { pitch: 0.2, roll: 0 }, updatedAt: now - 40 * DAY }), now);
    expect(c.plusMinus).toBe(CLAIM_CALIBRATED_DEG); // not blocked
    expect(c.stale).toBe(true);
    expect(c.ageDays).toBe(40);
    expect(c.text).toContain('REVERSE');
  });

  it('clearing the bias returns the claim to ±0.5°', () => {
    const c = claimFor(profile()); // levelBias removed
    expect(c.plusMinus).toBe(CLAIM_UNCALIBRATED_DEG);
  });
});

/* ---------------- zero session ---------------- */

describe('LevelSession — per-mode session zero', () => {
  it('zeroes and clears a scalar mode, visibly distinct per mode', () => {
    const s = new LevelSession();
    expect(s.zeroed('edge')).toBe(false);
    s.zeroHere('edge', 2);
    expect(s.zeroed('edge')).toBe(true);
    expect(s.applyScalar('edge', 5)).toBeCloseTo(3, 12);
    // plumb is untouched by the edge zero
    expect(s.zeroed('plumb')).toBe(false);
    expect(s.applyScalar('plumb', 5)).toBe(5);
    s.clearZero('edge');
    expect(s.zeroed('edge')).toBe(false);
    expect(s.applyScalar('edge', 5)).toBe(5);
  });

  it('surface zero offsets both axes and clears together', () => {
    const s = new LevelSession();
    s.zeroHere('surface', { pitchDeg: 1.2, rollDeg: -0.4 });
    const z = s.applySurface(1.2, -0.4);
    expect(z.pitchDeg).toBeCloseTo(0, 12);
    expect(z.rollDeg).toBeCloseTo(0, 12);
    s.clearZero('surface');
    expect(s.applySurface(1.2, -0.4).pitchDeg).toBeCloseTo(1.2, 12);
  });

  it('matches removeBias algebra', () => {
    const s = new LevelSession();
    s.zeroHere('plumb', 0.7);
    expect(s.applyScalar('plumb', 1.5)).toBeCloseTo(removeBias(1.5, 0.7), 12);
  });
});

/* ---------------- hold window ---------------- */

describe('HoldWindow — stats only over the held stretch', () => {
  it('any motion clears the window — approach never mixes into the hold', () => {
    const w = new HoldWindow();
    w.push(5, true);
    w.push(5, true);
    w.push(9, false); // motion
    expect(w.stats().n).toBe(0);
    w.push(1, true);
    expect(w.stats().n).toBe(1);
    expect(w.stats().mean).toBe(1);
  });

  it('computes mean and sample stddev', () => {
    const w = new HoldWindow();
    for (const v of [1, 2, 3, 4, 5]) w.push(v, true);
    const s = w.stats();
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(3, 12);
    expect(s.stddev).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  it('caps its length', () => {
    const w = new HoldWindow(10);
    for (let i = 0; i < 50; i++) w.push(i, true);
    expect(w.stats().n).toBe(10);
    expect(w.stats().mean).toBeCloseTo(44.5, 12);
  });
});

/* ---------------- save uncertainty ---------------- */

describe('uncertaintyForSave — never tighter than the calibration claim', () => {
  it('a very quiet window cannot undercut the claim (basis stays nominal)', () => {
    const u = uncertaintyForSave(0.5, { n: 60, mean: 1, stddev: 0.02 });
    expect(u.plusMinus).toBe(0.5);
    expect(u.basis).toBe('nominal');
  });

  it('scatter that dominates the claim ships as stddev', () => {
    const u = uncertaintyForSave(0.15, { n: 60, mean: 1, stddev: 0.4 });
    expect(u.plusMinus).toBeCloseTo(0.4, 12);
    expect(u.basis).toBe('stddev');
  });

  it('too few samples: nominal claim', () => {
    const u = uncertaintyForSave(0.15, { n: MIN_HOLD_SAMPLES - 1, mean: 1, stddev: 9 });
    expect(u.plusMinus).toBe(0.15);
    expect(u.basis).toBe('nominal');
  });
});

/* ---------------- display + save measurements ---------------- */

describe('displayMeasurement — the motion gate lives in the render path', () => {
  const claim = claimFor(profile());
  it('MOVING: basis unknown, no ± claim, POSSIBLE — an indication, not a measurement', () => {
    const m = displayMeasurement({ mode: 'edge', valueDeg: 1.2, stable: false, claim, tier: 'NONE' });
    expect(m.uncertainty.basis).toBe('unknown');
    expect(Number.isFinite(m.uncertainty.plusMinus)).toBe(false);
    expect(m.confidence).toBe('POSSIBLE');
    expect(m.unit).toBe('°');
  });

  it('HOLD uncalibrated: ±0.5° nominal, LIKELY', () => {
    const m = displayMeasurement({ mode: 'edge', valueDeg: 1.2, stable: true, claim, tier: 'NONE' });
    expect(m.uncertainty).toEqual({ plusMinus: 0.5, basis: 'nominal' });
    expect(m.confidence).toBe('LIKELY');
  });

  it('HOLD calibrated: ±0.15°, STRONG — confidence tightens only after reversal', () => {
    const cal = claimFor(profile({ levelBias: { pitch: 0, roll: 0 }, updatedAt: Date.now() }));
    const m = displayMeasurement({ mode: 'edge', valueDeg: 1.2, stable: true, claim: cal, tier: 'NONE' });
    expect(m.uncertainty.plusMinus).toBe(0.15);
    expect(m.confidence).toBe('STRONG');
  });

  it('confidenceFor never grants STRONG without calibration', () => {
    expect(confidenceFor(true, false)).toBe('LIKELY');
    expect(confidenceFor(true, true)).toBe('STRONG');
    expect(confidenceFor(false, true)).toBe('POSSIBLE');
  });
});

describe('buildSaveMeasurement — a complete §8 Measurement', () => {
  it('carries kind, unit, uncertainty, confidence, provenance, notes', () => {
    const claim = claimFor(profile());
    const m = buildSaveMeasurement({
      mode: 'plumb',
      valueDeg: -0.8,
      claim,
      stats: { n: 40, mean: -0.8, stddev: 0.03 },
      tier: 'PROXY',
      calibrations: { levelBias: { ok: false, ageMs: 0 } },
      zeroed: true,
      now: 123456,
      id: 'fixed-id',
    });
    expect(m.id).toBe('fixed-id');
    expect(m.kind).toBe('plumb');
    expect(m.unit).toBe('°');
    expect(m.uncertainty).toEqual({ plusMinus: 0.5, basis: 'nominal' });
    expect(m.confidence).toBe('LIKELY');
    expect(m.provenance.tier).toBe('PROXY');
    expect(m.provenance.sampleCount).toBe(40);
    expect(m.provenance.capturedAt).toBe(123456);
    expect(m.provenance.calibrations['levelBias']).toEqual({ ok: false, ageMs: 0 });
    expect(m.provenance.notes).toContain('mode:plumb');
    expect(m.provenance.notes).toContain('zeroed');
    expect(m.provenance.notes).toContain('uncalibrated');
  });
});

/* ---------------- reversal machine ---------------- */

function still(machine: ReversalMachine, pitchDeg: number, rollDeg: number, n: number): void {
  for (let i = 0; i < n; i++) machine.feed({ stable: true, pitchDeg, rollDeg });
}
function moving(machine: ReversalMachine, n: number): void {
  for (let i = 0; i < n; i++) machine.feed({ stable: false, pitchDeg: 99, rollDeg: 99 });
}

describe('ReversalMachine — measure, turn 180°, measure', () => {
  it('walks first → turn → second → done and recovers bias and true surface exactly', () => {
    // true surface: pitch 1.2°, roll 0.2; sensor bias: pitch 0.5°, roll 0.1°
    const m = new ReversalMachine(20, 5);
    expect(m.state).toBe('first');
    still(m, 1.7, 0.3, 20); // m1 = true + bias
    expect(m.state).toBe('turn');
    moving(m, 6); // the 180° turn is observable as motion…
    still(m, -0.7, -0.1, 1); // …then stillness again
    expect(m.state).toBe('second');
    still(m, -0.7, -0.1, 20); // m2 = −true + bias
    expect(m.state).toBe('done');
    const r = m.result;
    expect(r).not.toBeNull();
    expect(r!.biasPitchDeg).toBeCloseTo(0.5, 10);
    expect(r!.biasRollDeg).toBeCloseTo(0.1, 10);
    expect(r!.surfacePitchDeg).toBeCloseTo(1.2, 10);
    expect(r!.surfaceRollDeg).toBeCloseTo(0.2, 10);
  });

  it('motion during a capture restarts that capture — no mixed windows', () => {
    const m = new ReversalMachine(10, 3);
    still(m, 1.0, 0, 5);
    moving(m, 1);
    still(m, 1.0, 0, 9);
    expect(m.state).toBe('first'); // the 5 pre-motion samples did not count
    still(m, 1.0, 0, 1);
    expect(m.state).toBe('turn');
  });

  it('brief jitter below the motion threshold does not count as the turn', () => {
    const m = new ReversalMachine(5, 5);
    still(m, 1.0, 0, 5);
    expect(m.state).toBe('turn');
    moving(m, 3); // under motionSamples
    still(m, 1.0, 0, 1);
    expect(m.state).toBe('turn'); // not fooled
  });

  it('forceTurnDone (tap-dismiss path) advances without motion evidence', () => {
    const m = new ReversalMachine(5, 5);
    still(m, 1.0, 0, 5);
    expect(m.state).toBe('turn');
    m.forceTurnDone();
    expect(m.state).toBe('second');
    still(m, -0.4, 0, 5);
    expect(m.state).toBe('done');
    expect(m.result!.biasPitchDeg).toBeCloseTo(0.3, 10);
  });

  it('applied bias corrects the reading; clearing restores the raw reading', () => {
    const r = { biasPitchDeg: 0.5, biasRollDeg: 0.1 };
    // applying: display = measured − bias (removeBias)
    expect(removeBias(1.7, r.biasPitchDeg)).toBeCloseTo(1.2, 12);
    // clearing: profile without levelBias → claim widens (claimFor above)
    const cleared = claimFor(profile());
    expect(cleared.plusMinus).toBe(CLAIM_UNCALIBRATED_DEG);
  });
});

/**
 * Slope strip derivation (src/tools/level/levelState.slopeStripModel):
 * every trade form derives from levelMath.slopeFromAngle, each with a
 * propagated ±, labels stable, drain callout gated to the plausible range
 * with its message verbatim from levelMath.drainSlopeCheck.
 */
import { describe, expect, it } from 'vitest';
import { drainSlopeCheck, slopeFromAngle } from '../../src/geometry/levelMath';
import {
  DRAIN_SHOW_MAX_IN_PER_FT,
  DRAIN_SHOW_MIN_IN_PER_FT,
  slopeStripModel,
} from '../../src/tools/level/levelState';

const RAD = Math.PI / 180;

describe('slopeStripModel — values and labels', () => {
  it('rows carry the four fixed labels in order', () => {
    const m = slopeStripModel(3, 0.15);
    expect(m.rows.map((r) => r.label)).toEqual(['ANGLE', 'GRADE', 'PER FOOT', 'PER METRE']);
  });

  it('every value matches slopeFromAngle exactly — derived, not re-derived', () => {
    const angle = 2.5;
    const s = slopeFromAngle(angle * RAD);
    const m = slopeStripModel(angle, 0.15);
    expect(m.rows[0]!.value).toBeCloseTo(s.degrees, 12);
    expect(m.rows[1]!.value).toBeCloseTo(s.percentGrade, 12);
    expect(m.rows[2]!.value).toBeCloseTo(s.inPerFt, 12);
    expect(m.rows[3]!.value).toBeCloseTo(s.mmPerM, 12);
    expect(m.rows[0]!.unit).toBe('°');
    expect(m.rows[1]!.unit).toBe('%');
    expect(m.rows[2]!.unit).toBe('in/ft');
    expect(m.rows[3]!.unit).toBe('mm/m');
  });

  it('every row carries a finite positive ± propagated from the claim', () => {
    for (const r of slopeStripModel(4, 0.5).rows) {
      expect(Number.isFinite(r.plusMinus)).toBe(true);
      expect(r.plusMinus).toBeGreaterThan(0);
    }
  });

  it('± propagation is d/dθ of each form: sec²θ · claim', () => {
    const angle = 5;
    const claim = 0.15;
    const sec2 = 1 / Math.cos(angle * RAD) ** 2;
    const m = slopeStripModel(angle, claim);
    expect(m.rows[0]!.plusMinus).toBeCloseTo(claim, 12);
    expect(m.rows[1]!.plusMinus).toBeCloseTo(100 * sec2 * claim * RAD, 12);
    expect(m.rows[2]!.plusMinus).toBeCloseTo(12 * sec2 * claim * RAD, 12);
    expect(m.rows[3]!.plusMinus).toBeCloseTo(1000 * sec2 * claim * RAD, 12);
  });

  it('a tighter claim tightens every derived ± — the strip inherits calibration state', () => {
    const wide = slopeStripModel(3, 0.5);
    const tight = slopeStripModel(3, 0.15);
    for (let i = 0; i < wide.rows.length; i++) {
      expect(tight.rows[i]!.plusMinus).toBeLessThan(wide.rows[i]!.plusMinus);
    }
  });
});

describe('rise:run', () => {
  it('inside the claim there is no run number — LEVEL, not a fictional 1:∞', () => {
    expect(slopeStripModel(0.1, 0.5).riseRun).toBeNull();
    expect(slopeStripModel(0.0, 0.15).riseRun).toBeNull();
  });

  it('outside the claim: run for 1 rise, with a ±', () => {
    const m = slopeStripModel(3, 0.15);
    expect(m.riseRun).not.toBeNull();
    expect(m.riseRun!.run).toBeCloseTo(1 / Math.tan(3 * RAD), 9);
    expect(m.riseRun!.plusMinus).toBeGreaterThan(0);
  });
});

describe('drain callout — message verbatim from levelMath, gated to the plausible range', () => {
  it('shows in-band at ¼″/ft (a 1.19° pipe)', () => {
    const angle = Math.atan(0.25 / 12) / RAD;
    const m = slopeStripModel(angle, 0.15);
    expect(m.drain).not.toBeNull();
    expect(m.drain!.state).toBe('in-band');
    expect(m.drain!.message).toBe(drainSlopeCheck(Math.abs(slopeFromAngle(angle * RAD).inPerFt)).message);
  });

  it('shows over above ½″/ft, message verbatim', () => {
    const m = slopeStripModel(3, 0.15); // 0.629 in/ft
    expect(m.drain!.state).toBe('over');
    expect(m.drain!.message).toBe(drainSlopeCheck(12 * Math.tan(3 * RAD)).message);
  });

  it('hides outside the plausible drain range on both sides', () => {
    const below = Math.atan((DRAIN_SHOW_MIN_IN_PER_FT * 0.5) / 12) / RAD;
    const above = Math.atan((DRAIN_SHOW_MAX_IN_PER_FT * 1.5) / 12) / RAD;
    expect(slopeStripModel(below, 0.15).drain).toBeNull();
    expect(slopeStripModel(above, 0.15).drain).toBeNull();
  });

  it('uses the magnitude — a downhill pipe is still a drain', () => {
    const m = slopeStripModel(-1.2, 0.15);
    expect(m.drain).not.toBeNull();
    expect(m.drain!.state).toBe('in-band');
  });
});

/**
 * Level math — SPEC §4.2, §10.1. The six cardinal device orientations worked
 * out from the documented convention (not assumed):
 *
 *   pitch = atan2(−ax, √(ay² + az²)),  roll = atan2(ay, az)
 *
 * with accelerationIncludingGravity pointing AWAY from the earth at rest
 * (face-up ⇒ az ≈ +9.81). So:
 *
 *   face-up          a = ( 0,  0, +g) → pitch   0°, roll    0°
 *   face-down        a = ( 0,  0, −g) → pitch   0°, roll +180°
 *   portrait upright a = ( 0, +g,  0) → pitch   0°, roll  +90°   (top edge up)
 *   portrait flipped a = ( 0, −g,  0) → pitch   0°, roll  −90°
 *   right edge down  a = (−g,  0,  0) → pitch +90°, roll = atan2(0,0) = 0 (gimbal)
 *   left edge down   a = (+g,  0,  0) → pitch −90°, roll = atan2(0,0) = 0 (gimbal)
 *
 * Plus reversal-calibration algebra, bias removal, slope conversions, and the
 * drain-slope band.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAIN_MAX_IN_PER_FT,
  DRAIN_MIN_IN_PER_FT,
  drainSlopeCheck,
  outOverRun,
  pitchRollFromGravity,
  removeBias,
  reversalCalibration,
  slopeFromAngle,
} from '../../src/geometry/levelMath';

const G = 9.81;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pitchRollFromGravity — all six cardinal orientations', () => {
  it('flat face-up (0, 0, +g): pitch 0, roll 0', () => {
    const { pitch, roll } = pitchRollFromGravity(0, 0, G);
    expect(pitch * DEG).toBeCloseTo(0, 9);
    expect(roll * DEG).toBeCloseTo(0, 9);
  });

  it('flat face-down (0, 0, −g): pitch 0, roll +180°', () => {
    const { pitch, roll } = pitchRollFromGravity(0, 0, -G);
    expect(pitch * DEG).toBeCloseTo(0, 9);
    expect(roll * DEG).toBeCloseTo(180, 9);
  });

  it('portrait upright, top edge up (0, +g, 0): pitch 0, roll +90°', () => {
    const { pitch, roll } = pitchRollFromGravity(0, G, 0);
    expect(pitch * DEG).toBeCloseTo(0, 9);
    expect(roll * DEG).toBeCloseTo(90, 9);
  });

  it('portrait upside down (0, −g, 0): pitch 0, roll −90°', () => {
    const { pitch, roll } = pitchRollFromGravity(0, -G, 0);
    expect(pitch * DEG).toBeCloseTo(0, 9);
    expect(roll * DEG).toBeCloseTo(-90, 9);
  });

  it('landscape, right edge down (−g, 0, 0): pitch +90°, roll finite (gimbal)', () => {
    const { pitch, roll } = pitchRollFromGravity(-G, 0, 0);
    expect(pitch * DEG).toBeCloseTo(90, 9);
    expect(Number.isFinite(roll)).toBe(true); // atan2(0,0) = 0 — defined, not NaN
  });

  it('landscape, left edge down (+g, 0, 0): pitch −90°, roll finite (gimbal)', () => {
    const { pitch, roll } = pitchRollFromGravity(G, 0, 0);
    expect(pitch * DEG).toBeCloseTo(-90, 9);
    expect(Number.isFinite(roll)).toBe(true);
  });
});

describe('pitchRollFromGravity — gimbal-adjacent stability', () => {
  it('stays finite and pinned near ±90° pitch under small perturbations', () => {
    const rnd = mulberry32(0xf00d);
    for (let k = 0; k < 200; k++) {
      const ey = (rnd() - 0.5) * 0.1;
      const ez = (rnd() - 0.5) * 0.1;
      const { pitch, roll } = pitchRollFromGravity(-G, ey, ez);
      expect(Number.isFinite(pitch)).toBe(true);
      expect(Number.isFinite(roll)).toBe(true);
      expect(pitch * DEG).toBeGreaterThan(89.4); // ~0.07 g of noise ⇒ < 0.6° off vertical
      expect(pitch * DEG).toBeLessThanOrEqual(90);
    }
  });

  it('pitch is bounded to [−90°, +90°], roll to (−180°, +180°]', () => {
    const rnd = mulberry32(0xbeef);
    for (let k = 0; k < 500; k++) {
      const ax = (rnd() - 0.5) * 2 * G;
      const ay = (rnd() - 0.5) * 2 * G;
      const az = (rnd() - 0.5) * 2 * G;
      const { pitch, roll } = pitchRollFromGravity(ax, ay, az);
      expect(pitch * DEG).toBeGreaterThanOrEqual(-90);
      expect(pitch * DEG).toBeLessThanOrEqual(90);
      expect(roll * DEG).toBeGreaterThan(-180 - 1e-9);
      expect(roll * DEG).toBeLessThanOrEqual(180);
      expect(Number.isFinite(pitch) && Number.isFinite(roll)).toBe(true);
    }
  });
});

describe('reversal calibration — SPEC §4.2.2', () => {
  it('m1 = true + bias, m2 = −true + bias recovers both exactly', () => {
    const { surface, bias } = reversalCalibration(1.7 + 0.3, -1.7 + 0.3);
    expect(surface).toBeCloseTo(1.7, 12);
    expect(bias).toBeCloseTo(0.3, 12);
  });

  it('property: recovery over 500 random surface/bias pairs', () => {
    const rnd = mulberry32(0xcafe);
    for (let k = 0; k < 500; k++) {
      const trueAngle = (rnd() - 0.5) * 10;
      const trueBias = (rnd() - 0.5) * 2;
      const { surface, bias } = reversalCalibration(trueAngle + trueBias, -trueAngle + trueBias);
      expect(surface).toBeCloseTo(trueAngle, 10);
      expect(bias).toBeCloseTo(trueBias, 10);
    }
  });

  it('removeBias subtracts the stored bias from a reading', () => {
    const { bias } = reversalCalibration(2.05, -1.95);
    expect(bias).toBeCloseTo(0.05, 12);
    expect(removeBias(2.05, bias)).toBeCloseTo(2.0, 12);
  });
});

describe('slope conversions — SPEC §4.2.3', () => {
  it('45° reads 100% grade, 12 in/ft, 1000 mm/m, 1:1', () => {
    const s = slopeFromAngle(45 * RAD);
    expect(s.degrees).toBeCloseTo(45, 9);
    expect(s.percentGrade).toBeCloseTo(100, 9);
    expect(s.inPerFt).toBeCloseTo(12, 9);
    expect(s.mmPerM).toBeCloseTo(1000, 9);
    expect(s.riseRun.rise).toBe(1);
    expect(s.riseRun.run).toBeCloseTo(1, 9);
  });

  it('level reads zero everywhere, rise:run 0:1', () => {
    const s = slopeFromAngle(0);
    expect(s.percentGrade).toBe(0);
    expect(s.inPerFt).toBe(0);
    expect(s.mmPerM).toBe(0);
    expect(s.riseRun).toEqual({ rise: 0, run: 1 });
  });

  it('a downhill angle carries its sign: −1° is a negative grade, rise −1', () => {
    const s = slopeFromAngle(-1 * RAD);
    expect(s.percentGrade).toBeCloseTo(-1.7455, 3);
    expect(s.riseRun.rise).toBe(-1);
    expect(s.riseRun.run).toBeCloseTo(57.29, 2);
  });

  it('the code drain slope in angle form: atan(0.25/12) reads ¼ in/ft', () => {
    const s = slopeFromAngle(Math.atan(0.25 / 12));
    expect(s.inPerFt).toBeCloseTo(0.25, 12);
  });
});

describe('outOverRun — “out by X over 8 ft”', () => {
  it('0.5° over a 96″ run is 0.838″ out', () => {
    expect(outOverRun(0.5 * RAD, 96)).toBeCloseTo(0.8378, 3);
  });

  it('level runs out by nothing; sign follows the angle', () => {
    expect(outOverRun(0, 96)).toBe(0);
    expect(outOverRun(-0.5 * RAD, 96)).toBeCloseTo(-0.8378, 3);
  });
});

describe('drainSlopeCheck — the ¼″–½″ per ft band', () => {
  it('flags under, in-band, and over with the band edges counting as in-band', () => {
    expect(drainSlopeCheck(0.125).state).toBe('under');
    expect(drainSlopeCheck(DRAIN_MIN_IN_PER_FT).state).toBe('in-band');
    expect(drainSlopeCheck(0.375).state).toBe('in-band');
    expect(drainSlopeCheck(DRAIN_MAX_IN_PER_FT).state).toBe('in-band');
    expect(drainSlopeCheck(0.75).state).toBe('over');
  });

  it('speaks the code-standard callout in BRAND voice, no apology, no hedge', () => {
    const banned = /\b(simply|just|easy|sorry|please)\b/i;
    for (const x of [0.1, 0.3, 0.9]) {
      const check = drainSlopeCheck(x);
      expect(check.message.length).toBeGreaterThan(0);
      expect(check.message).toMatch(/¼″/);
      expect(check.message).not.toMatch(banned);
      expect(check.inPerFt).toBe(x);
    }
  });
});

/**
 * Level/plumb math — SPEC §4.2. Axis convention (devicemotion, W3C):
 * x right, y toward the top edge of the screen, z out of the screen.
 * Gravity vector components below are from `accelerationIncludingGravity`,
 * which points AWAY from the earth when the device is at rest face-up
 * (az ≈ +9.81 face-up on Android/W3C convention).
 *
 *   pitch = atan2(-ax, sqrt(ay² + az²))
 *   roll  = atan2(ay, az)
 *
 * Operationally (worked out from the formulas; truth table pinned in
 * tests/unit/level-math.test.ts):
 *   pitch — how far the device's x axis dips below horizontal: 0 when the
 *           left/right edges are level, +90° with the right edge straight
 *           down, −90° with the left edge straight down.
 *   roll  — rotation about the device's x axis from face-up: 0 face-up,
 *           +90° standing upright (top edge up), ±180° face-down,
 *           −90° upside down. Undefined at pitch ±90° (gimbal); atan2(0,0)
 *           returns 0 there — finite, never NaN.
 *
 * Owned by A4 (Craft Math) from Phase 1 on; `pitchRollFromGravity`'s signature
 * is frozen — the sensor fusion (A1) imports it.
 */

export interface PitchRoll { pitch: number; roll: number; }

/** Radians. Cardinal-orientation behavior is pinned in tests/unit/level-math.test.ts. */
export function pitchRollFromGravity(ax: number, ay: number, az: number): PitchRoll {
  return {
    pitch: Math.atan2(-ax, Math.hypot(ay, az)),
    roll: Math.atan2(ay, az),
  };
}

/**
 * Two-position reversal calibration — SPEC §4.2.2. Measure a surface (m1),
 * rotate the phone 180° in plane, measure again (m2):
 *   true surface angle = (m1 − m2) / 2,   sensor bias = (m1 + m2) / 2.
 */
export function reversalCalibration(m1: number, m2: number): { surface: number; bias: number } {
  return { surface: (m1 - m2) / 2, bias: (m1 + m2) / 2 };
}

/** Subtract a stored per-axis bias (from reversalCalibration) from a reading. */
export function removeBias(measured: number, bias: number): number {
  return measured - bias;
}

// ---------------------------------------------------------------------------
// Slope conversions — SPEC §4.2.3. One measured angle, every way a trade
// states it. All derive from tan θ; the UI shows them simultaneously.
// ---------------------------------------------------------------------------

export interface SlopeReadout {
  degrees: number;
  /** 100 · tan θ */
  percentGrade: number;
  /** 12 · tan θ — inches of rise per foot of run. */
  inPerFt: number;
  /** 1000 · tan θ — millimetres of rise per metre of run. */
  mmPerM: number;
  /**
   * rise:run with rise normalized to ±1 (e.g. 1:12). Level reads {0, 1}.
   * Near plumb the run approaches 0 and the ratio form stops being useful —
   * the LEVEL tool switches to plumb language well before that.
   */
  riseRun: { rise: number; run: number };
}

/** All slope forms from one angle in radians. */
export function slopeFromAngle(thetaRad: number): SlopeReadout {
  const t = Math.tan(thetaRad);
  const riseRun = t === 0 ? { rise: 0, run: 1 } : { rise: Math.sign(t), run: 1 / Math.abs(t) };
  return {
    degrees: thetaRad * (180 / Math.PI),
    percentGrade: 100 * t,
    inPerFt: 12 * t,
    mmPerM: 1000 * t,
    riseRun,
  };
}

/**
 * How far out over a run: out = tan(θ) · L — SPEC §4.2.3's
 * "out by X over 8 ft". Same units as runLength.
 */
export function outOverRun(thetaRad: number, runLength: number): number {
  return Math.tan(thetaRad) * runLength;
}

// ---------------------------------------------------------------------------
// Drain slope check — SPEC §4.2.3. ¼″ per foot is the code-standard drain
// slope; the working band runs ¼″–½″ per foot.
// ---------------------------------------------------------------------------

export const DRAIN_MIN_IN_PER_FT = 0.25;
export const DRAIN_MAX_IN_PER_FT = 0.5;

export interface DrainCheck {
  state: 'under' | 'in-band' | 'over';
  inPerFt: number;
  message: string;
}

/** Band edges count as in-band. Copy follows kit/BRAND.md. */
export function drainSlopeCheck(inPerFt: number): DrainCheck {
  if (inPerFt < DRAIN_MIN_IN_PER_FT) {
    return {
      state: 'under',
      inPerFt,
      message: 'Under ¼″ per foot — below the code-standard drain slope. Water will stand in the line.',
    };
  }
  if (inPerFt > DRAIN_MAX_IN_PER_FT) {
    return {
      state: 'over',
      inPerFt,
      message: 'Over ½″ per foot — liquids outrun solids above the band. Keep drain lines between ¼″ and ½″ per foot, or plan a vertical drop.',
    };
  }
  return {
    state: 'in-band',
    inPerFt,
    message: "Inside the ¼″–½″ per foot band. That's the code-standard drain slope.",
  };
}

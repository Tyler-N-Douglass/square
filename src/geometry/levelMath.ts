/**
 * Level/plumb math — SPEC §4.2. Axis convention (devicemotion, W3C):
 * x right, y toward the top edge of the screen, z out of the screen.
 * Gravity vector components below are from `accelerationIncludingGravity`,
 * which points AWAY from the earth when the device is at rest face-up
 * (az ≈ +9.81 face-up on Android/W3C convention).
 *
 *   pitch = atan2(-ax, sqrt(ay² + az²))   — rotation about the x axis
 *   roll  = atan2(ay, az)                 — rotation about the y axis
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

/**
 * LEVEL mode math — pure, unit-tested (tests/unit/level-tool-modes.test.ts).
 *
 * Everything here derives from the fusion's pitch/roll (radians, SPEC §4.2.1
 * axis convention — see src/geometry/levelMath.ts). The unit gravity-UP
 * vector in the device frame reconstructs from pitch/roll exactly:
 *
 *   ux = −sin(pitch)
 *   uy =  cos(pitch)·sin(roll)
 *   uz =  cos(pitch)·cos(roll)
 *
 * (Inverse of pitch = atan2(−ax, √(ay²+az²)), roll = atan2(ay, az) for a
 * unit vector — pinned against pitchRollFromGravity in the tests.)
 *
 * Mode angles, all in DEGREES at this layer (display layer works in degrees;
 * radians never leave the geometry):
 *
 *   SURFACE  phone flat, face up. pitch + roll shown separately; the total
 *            tilt (angle between device z and vertical) drives lock/tone.
 *   EDGE     phone standing on its long edge like a spirit level. The
 *            measured angle is the elevation of the device y axis above
 *            horizontal: asin(uy). Exact at any pitch — no gimbal trouble,
 *            because uy is well-defined where roll itself is not.
 *   PLUMB    phone flat against a vertical surface. The measured angle is
 *            the elevation of the device z axis (screen normal) above
 *            horizontal: asin(uz). For a plumb wall the normal is horizontal
 *            → 0°. Sign: positive = the screen normal points above the
 *            horizon (wall face tips upward / overhangs); negative = wall
 *            leans back. Works in portrait AND landscape against the wall —
 *            the number is a property of the plane, not of the grip.
 *   OVERLAY  screen tilt: rotation of the device about the view axis,
 *            relative to gravity — atan2(ux, uy). 0 when the top edge is
 *            straight up; positive when the top edge tilts toward device +x
 *            (device rotated counter-clockwise as the user sees it). This is
 *            also, exactly, the canvas angle of the true-horizontal line
 *            (see src/ui/overlay/overlayMath.ts).
 */

export type LevelMode = 'surface' | 'edge' | 'plumb' | 'overlay';

export const LEVEL_MODES: readonly LevelMode[] = ['surface', 'edge', 'plumb', 'overlay'];

/** Lock tolerance — SPEC §4.2.3, matches audio.LEVEL_DEADBAND_DEG. */
export const LOCK_TOL_DEG = 0.2;

const DEG = 180 / Math.PI;

function clamp1(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** Unit gravity-UP vector in the device frame from fusion pitch/roll (radians). */
export function gravityUpFromPitchRoll(pitchRad: number, rollRad: number): [number, number, number] {
  return [
    -Math.sin(pitchRad),
    Math.cos(pitchRad) * Math.sin(rollRad),
    Math.cos(pitchRad) * Math.cos(rollRad),
  ];
}

/** EDGE: elevation of the device y (long) axis above horizontal, degrees. */
export function edgeAngleDeg(pitchRad: number, rollRad: number): number {
  const [, uy] = gravityUpFromPitchRoll(pitchRad, rollRad);
  return Math.asin(clamp1(uy)) * DEG;
}

/** PLUMB: elevation of the screen normal above horizontal, degrees.
 *  0 = the surface the phone rests against is plumb. */
export function plumbAngleDeg(pitchRad: number, rollRad: number): number {
  const [, , uz] = gravityUpFromPitchRoll(pitchRad, rollRad);
  return Math.asin(clamp1(uz)) * DEG;
}

/** SURFACE: total tilt of the resting plane — angle between device z and
 *  vertical, degrees, always ≥ 0. Drives lock and the slope strip. */
export function surfaceTiltDeg(pitchRad: number, rollRad: number): number {
  const [, , uz] = gravityUpFromPitchRoll(pitchRad, rollRad);
  return Math.acos(clamp1(Math.abs(uz))) * DEG;
}

/** OVERLAY: screen tilt about the view axis, degrees. 0 = top edge straight
 *  up. Positive = top edge tilted toward device +x (counter-clockwise as the
 *  user sees the screen). */
export function screenTiltDeg(pitchRad: number, rollRad: number): number {
  const [ux, uy] = gravityUpFromPitchRoll(pitchRad, rollRad);
  if (ux === 0 && uy === 0) return 0; // screen exactly horizontal — tilt undefined, report 0
  return Math.atan2(ux, uy) * DEG;
}

/** The one angle a mode measures, degrees (surface uses the two-axis pair
 *  separately for display; its primary is the total tilt). */
export function primaryAngleDeg(mode: LevelMode, pitchRad: number, rollRad: number): number {
  switch (mode) {
    case 'surface': return surfaceTiltDeg(pitchRad, rollRad);
    case 'edge': return edgeAngleDeg(pitchRad, rollRad);
    case 'plumb': return plumbAngleDeg(pitchRad, rollRad);
    case 'overlay': return screenTiltDeg(pitchRad, rollRad);
  }
}

/** Measurement kind per mode — SPEC §8. */
export function kindForMode(mode: LevelMode): 'level' | 'plumb' {
  return mode === 'plumb' ? 'plumb' : 'level';
}

/**
 * SURFACE bubble position, px offsets from field center for a dot in a
 * square field. The bubble rises to the HIGH side, like the real vial:
 *   pitch > 0 (right edge down) → high side left  → dot x negative
 *   roll  > 0 (top edge up)     → high side top   → dot y negative (CSS y down)
 * Full scale ±fullScaleDeg maps to ±halfPx, clamped at the rim.
 */
export function bubbleXY(
  pitchDeg: number,
  rollDeg: number,
  fullScaleDeg: number,
  halfPx: number,
): { x: number; y: number } {
  const k = halfPx / fullScaleDeg;
  const clampPx = (v: number): number => Math.min(halfPx, Math.max(-halfPx, v));
  return { x: clampPx(-pitchDeg * k), y: clampPx(-rollDeg * k) };
}

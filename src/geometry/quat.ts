/**
 * Quaternion algebra over the shared Quat interface (src/types.ts — read-only
 * contract, ADR-003). Owned by A3 (Geometry/Vision).
 *
 * Conventions (documented per SPEC §10.1; also in docs/physics-geometry.md):
 *  - Unit quaternions represent rotations; q and −q are the same rotation.
 *  - Hamilton product: qMultiply(a, b) = a⊗b, and rotation composition is
 *    R(a⊗b) = R(a)∘R(b) — b's rotation is applied first.
 *  - qRotateVec(q, v) = q ⊗ (0,v) ⊗ q* rotates the VECTOR (active rotation),
 *    right-handed about the axis.
 *  - Euler convention: intrinsic Tait–Bryan Z-Y′-X″ (yaw about z, then pitch
 *    about the new y, then roll about the newest x), radians:
 *      q = qz(yaw) ⊗ qy(pitch) ⊗ qx(roll)
 *    Gimbal lock sits at pitch = ±90°; qToEuler clamps the asin argument so
 *    the round trip q → euler → q stays a valid rotation there.
 *    Round-trip stability is property-tested over 10⁴ seeded random rotations
 *    in tests/unit/geometry-algebra.test.ts.
 */
import type { Mat3, Quat, Vec3 } from '../types';
import { vAdd, vCross, vScale } from './vec';

export const qIdentity = (): Quat => ({ w: 1, x: 0, y: 0, z: 0 });

/** Hamilton product a⊗b (apply b's rotation first, then a's). */
export function qMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Conjugate = inverse for unit quaternions. */
export const qConjugate = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

export const qNorm = (q: Quat): number => Math.hypot(q.w, q.x, q.y, q.z);

/**
 * Unit quaternion. A degenerate (zero/non-finite norm) input returns the
 * identity — the only sane rotation to fall back to, and the caller's fusion
 * stability gate is responsible for flagging the condition.
 */
export function qNormalize(q: Quat): Quat {
  const n = qNorm(q);
  if (!Number.isFinite(n) || n <= 0) return qIdentity();
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

/** Rotation of angleRad (right-handed) about axis. Zero axis → identity. */
export function qFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!Number.isFinite(n) || n <= 0) return qIdentity();
  const half = angleRad / 2;
  const s = Math.sin(half) / n;
  return { w: Math.cos(half), x: axis[0] * s, y: axis[1] * s, z: axis[2] * s };
}

/** Active rotation of v by q: q ⊗ (0,v) ⊗ q*, in the efficient two-cross form. */
export function qRotateVec(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q.x, q.y, q.z];
  const t = vScale(vCross(u, v), 2);
  return vAdd(vAdd(v, vScale(t, q.w)), vCross(u, t));
}

export interface EulerZYX {
  /** Rotation about z, applied first (radians). */
  yawRad: number;
  /** Rotation about the once-rotated y (radians), in [−π/2, π/2]. */
  pitchRad: number;
  /** Rotation about the twice-rotated x, applied last (radians). */
  rollRad: number;
}

/** q = qz(yaw) ⊗ qy(pitch) ⊗ qx(roll) — built by composition, not transcription. */
export function qFromEuler(e: EulerZYX): Quat {
  const qz = qFromAxisAngle([0, 0, 1], e.yawRad);
  const qy = qFromAxisAngle([0, 1, 0], e.pitchRad);
  const qx = qFromAxisAngle([1, 0, 0], e.rollRad);
  return qMultiply(qMultiply(qz, qy), qx);
}

/**
 * Inverse of qFromEuler for unit q. Standard Z-Y-X extraction from the
 * rotation matrix R = Rz(yaw)·Ry(pitch)·Rx(roll):
 *   pitch = asin(−R₂₀) = asin(2(wy − xz))   (argument clamped to [−1,1])
 *   roll  = atan2(R₂₁, R₂₂) = atan2(2(yz + wx), 1 − 2(x² + y²))
 *   yaw   = atan2(R₁₀, R₀₀) = atan2(2(xy + wz), 1 − 2(y² + z²))
 * At gimbal lock (|pitch| = 90°) yaw and roll are not separable; the returned
 * pair still reconstructs the same rotation through qFromEuler.
 */
export function qToEuler(q: Quat): EulerZYX {
  const n = qNormalize(q);
  const s = 2 * (n.w * n.y - n.x * n.z);
  const pitchRad = Math.asin(Math.min(1, Math.max(-1, s)));
  const rollRad = Math.atan2(2 * (n.y * n.z + n.w * n.x), 1 - 2 * (n.x * n.x + n.y * n.y));
  const yawRad = Math.atan2(2 * (n.x * n.y + n.w * n.z), 1 - 2 * (n.y * n.y + n.z * n.z));
  return { yawRad, pitchRad, rollRad };
}

/** Rotation matrix of unit q (column-vector convention: v' = M·v = qRotateVec(q, v)). */
export function qToMat3(q: Quat): Mat3 {
  const { w, x, y, z } = qNormalize(q);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Vec3 algebra over the shared Vec3 tuple (src/types.ts — read-only contract,
 * ADR-003). Pure functions; used by the solver worker and the fusion code.
 * Owned by A3 (Geometry/Vision). Property-tested in
 * tests/unit/geometry-algebra.test.ts.
 */
import type { Vec3 } from '../types';

export const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const vScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export const vDot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Right-handed cross product. */
export const vCross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const vLen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const vDist = (a: Vec3, b: Vec3): number => vLen(vSub(a, b));

/**
 * Unit vector, or null when the input has no direction (zero / non-finite
 * length). Callers must handle null — a degenerate direction is a refusal
 * path, never a silent [0,0,0] (SPEC §15.3).
 */
export function vNormalize(a: Vec3): Vec3 | null {
  const n = vLen(a);
  if (!Number.isFinite(n) || n <= 0) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
}

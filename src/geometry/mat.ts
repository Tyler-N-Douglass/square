/**
 * Mat3 algebra over the shared row-major Mat3 tuple (src/types.ts — read-only
 * contract, ADR-003). Row-major layout: element (r,c) is m[3*r + c].
 * Inverse is computed via the adjugate (SPEC §10.1); a matrix whose
 * determinant is negligible relative to its scale returns null rather than an
 * exploded inverse. Owned by A3 (Geometry/Vision). Property-tested in
 * tests/unit/geometry-algebra.test.ts.
 */
import type { Mat3, Vec3 } from '../types';

export const mat3Identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Row-major product a·b. */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** m·v (column vector convention). */
export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Inverse via adjugate/determinant. Returns null when |det| < 1e-12·scale³
 * (scale = largest |entry|) — i.e. when the matrix is singular at the
 * precision that matters, relative to its own magnitude.
 */
export function mat3Inverse(m: Mat3): Mat3 | null {
  const det = mat3Det(m);
  let scale = 0;
  for (const e of m) scale = Math.max(scale, Math.abs(e));
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) < 1e-12 * scale * scale * scale) {
    return null;
  }
  const inv = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ];
}

export function mat3FromRows(r0: Vec3, r1: Vec3, r2: Vec3): Mat3 {
  return [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]];
}

export function mat3FromCols(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

export function mat3Col(m: Mat3, i: 0 | 1 | 2): Vec3 {
  return [m[i], m[(3 + i) as 3 | 4 | 5], m[(6 + i) as 6 | 7 | 8]];
}

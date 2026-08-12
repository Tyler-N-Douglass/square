/**
 * Vanishing-point recovery and homogeneous-safe back-projection — SPEC §4.3.1.
 * Owned by A3 (Geometry/Vision). Tested in tests/unit/geometry-vanishing.test.ts.
 *
 * Everything here stays in homogeneous coordinates. A vanishing point with
 * w = 0 (edge family parallel to the image plane — the fronto-parallel case)
 * is a perfectly good measurement and must flow through untouched; we never
 * divide by w. The numerically-unstable near-infinite cases are refused
 * upstream by quad validation + DLT conditioning (see angleSolver.ts), not by
 * special-casing w here.
 */
import type { Vec3 } from '../types';
import type { Mat3 } from '../types';
import { mat3Col } from './mat';
import { vCross, vLen } from './vec';
import type { Intrinsics, Px } from './angleSolver';

/** Homogeneous image line through two pixel points: l = p₁ × p₂. */
export function lineThroughPoints(p1: Px, p2: Px): Vec3 {
  return vCross([p1.x, p1.y, 1], [p2.x, p2.y, 1]);
}

/**
 * Two-parallel-lines path (SPEC §4.3.1.4a): given two image segments whose
 * world lines are parallel (both sides of a door jamb, both rails of a
 * frame), the family's vanishing point is v = l₁ × l₂ in homogeneous
 * coordinates. Nearly-parallel image lines give a far-away v — that is fine
 * and correct. Returns null only when the construction is degenerate: a
 * segment with (near-)coincident endpoints, or two segments lying on the
 * same image line, where v ≈ 0 and carries no direction at all.
 */
export function vanishingFromParallelSegments(
  a1: Px,
  a2: Px,
  b1: Px,
  b2: Px,
): Vec3 | null {
  for (const p of [a1, a2, b1, b2]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }
  const l1 = lineThroughPoints(a1, a2);
  const l2 = lineThroughPoints(b1, b2);
  const n1 = vLen(l1);
  const n2 = vLen(l2);
  if (n1 <= 0 || n2 <= 0) return null; // coincident endpoints
  const v = vCross(l1, l2);
  // Same-line degeneracy: |l₁ × l₂| vanishes relative to |l₁||l₂|.
  if (vLen(v) <= 1e-12 * n1 * n2) return null;
  return v;
}

/**
 * The two vanishing points encoded in a unit-square→quad homography:
 * v₁ = H·[1,0,0]ᵀ (column 0), v₂ = H·[0,1,0]ᵀ (column 1). SPEC §4.3.1.6.
 */
export function vanishingPointsFromH(h: Mat3): { v1: Vec3; v2: Vec3 } {
  return { v1: mat3Col(h, 0), v2: mat3Col(h, 1) };
}

/**
 * Back-project a homogeneous vanishing point to a 3D direction in camera
 * coordinates: d = K⁻¹·v, kept homogeneous —
 *   d = [(vx − cx·vw)/f, (vy − cy·vw)/f, vw]
 * At vw = 0 this degenerates gracefully to a direction parallel to the image
 * plane. NOT normalized and sign-ambiguous; see resolveDirectionSign.
 */
export function backprojectDirection(v: Vec3, k: Intrinsics): Vec3 {
  return [(v[0] - k.cx * v[2]) / k.fPx, (v[1] - k.cy * v[2]) / k.fPx, v[2]];
}

/**
 * Homogeneous-safe image-space direction "from `from` toward the vanishing
 * point v": (vx − from.x·vw, vy − from.y·vw). For vw > 0 this is a positive
 * multiple of (v/vw − from); for vw < 0 the sign flip is exactly what the
 * projective geometry requires (the image point of a receding world point
 * moves away from the dehomogenized v when the direction's z-component is
 * negative); for vw = 0 it is the line direction itself. Proof in
 * docs/physics-geometry.md §sign-resolution.
 */
export function imageDirectionToward(v: Vec3, from: Px): { x: number; y: number } {
  return { x: v[0] - from.x * v[2], y: v[1] - from.y * v[2] };
}

export type SignedDirection =
  | { ok: true; d: Vec3 }
  | { ok: false; message: string };

/**
 * Resolve the sign of the back-projected direction of v so that it points
 * from the corner p0 toward the adjacent image point `toward` (SPEC
 * §4.3.1.5's "sign/orientation resolved from the image ordering"). Rule:
 * flip d when the homogeneous-safe image direction toward v opposes the
 * image direction p0→toward. Refuses when the comparison is numerically
 * ambiguous instead of guessing a sign — the sign IS the obtuse/acute answer.
 */
export function resolveDirectionSign(
  v: Vec3,
  k: Intrinsics,
  p0: Px,
  toward: Px,
): SignedDirection {
  const d = backprojectDirection(v, k);
  const dirImg = imageDirectionToward(v, p0);
  const adj = { x: toward.x - p0.x, y: toward.y - p0.y };
  const nDir = Math.hypot(dirImg.x, dirImg.y);
  const nAdj = Math.hypot(adj.x, adj.y);
  if (!(nDir > 0) || !(nAdj > 0)) {
    return { ok: false, message: 'sign resolution degenerate: vanishing point coincides with the corner' };
  }
  const align = (dirImg.x * adj.x + dirImg.y * adj.y) / (nDir * nAdj);
  if (!Number.isFinite(align) || Math.abs(align) < 0.05) {
    return { ok: false, message: 'sign resolution ambiguous: edge direction cannot be oriented' };
  }
  return { ok: true, d: align < 0 ? [-d[0], -d[1], -d[2]] : d };
}

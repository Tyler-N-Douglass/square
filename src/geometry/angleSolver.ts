/**
 * True corner angle from a photographed quad — SPEC §4.3.1. Frozen contract
 * (ADR-003/ADR-004): tests/unit/angle-solver-groundtruth.test.ts calls exactly
 * this and is the single most important test in the repo.
 *
 * Input quad order: P0 = the corner being measured, P1 = adjacent vertex along
 * edge family one, P2 = the diagonal vertex, P3 = adjacent vertex along edge
 * family two. The quad is planar in the world (door frame, cabinet face).
 * Returns the angle at P0 between the two edge families, in degrees (0, 180),
 * signed/obtuse resolved from the image ordering — NOT folded to ≤ 90°.
 *
 * Refusal is a first-class outcome (SPEC §15.3): degenerate geometry returns
 * { ok: false, reason: 'POOR_GEOMETRY' } rather than a garbage number.
 */

export interface Intrinsics { fPx: number; cx: number; cy: number; }
export interface Px { x: number; y: number; }

export type QuadAngleResult =
  | { ok: true; thetaDeg: number }
  | { ok: false; reason: 'POOR_GEOMETRY'; message: string };

export function cornerAngleFromQuad(
  _quad: [Px, Px, Px, Px],
  _k: Intrinsics,
): QuadAngleResult {
  throw new Error('NOT IMPLEMENTED — A3 (Geometry/Vision) owns this. See kit/SPEC.md §4.3.1.');
}

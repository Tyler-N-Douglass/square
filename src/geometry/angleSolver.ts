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
 *
 * Pipeline (SPEC §4.3.1.6, derivation in docs/physics-geometry.md):
 *  1. Validate the quad: finite coords, non-tiny edges, no near-collinear
 *     vertex, convex and consistently ordered, non-vanishing normalized area.
 *  2. H: unit square → quad by normalized DLT (homography.ts). Conditioning
 *     failures refuse.
 *  3. v₁ = H·[1,0,0]ᵀ (column 0), v₂ = H·[0,1,0]ᵀ (column 1) — homogeneous
 *     throughout; a vanishing point exactly at infinity (w = 0, the
 *     fronto-parallel case) is valid and never divided out.
 *  4. d = K⁻¹·v per family, sign-resolved so each direction points from P0
 *     toward its adjacent vertex in the image (vanishing.ts) — this is what
 *     keeps 110° from collapsing to 70°.
 *  5. θ = acos(clamped d̂₁·d̂₂), full (0°, 180°) range.
 */
import type { Vec3 } from '../types';
import { homographyUnitSquareToQuad } from './homography';
import { resolveDirectionSign, vanishingPointsFromH } from './vanishing';
import { vDot, vNormalize } from './vec';

export interface Intrinsics { fPx: number; cx: number; cy: number; }
export interface Px { x: number; y: number; }

export type QuadAngleResult =
  | { ok: true; thetaDeg: number }
  | { ok: false; reason: 'POOR_GEOMETRY'; message: string };

/**
 * Refusal thresholds (SPEC §4.3.1.6 "reject ... and say so rather than
 * emitting garbage"). Values are justified against the ground-truth sweep in
 * docs/physics-geometry.md §refusal — the frozen sweep's worst pose clears
 * each by ≥ 2 orders of magnitude.
 */
export const QUAD_LIMITS = {
  /** Smallest usable quad: the longest edge must span at least this many px. */
  minQuadPx: 8,
  /** Shortest edge relative to the longest — below this a vertex pair has effectively merged. */
  minEdgeRatio: 1e-3,
  /** min |sin(vertex angle)| — below this a vertex is collinear with its neighbors. */
  minVertexSin: 0.02,
  /** min |shoelace area| / (longest edge)² — near-zero-area / near-collinear quads. */
  minNormalizedArea: 5e-3,
  /** min DLT pivot ratio (Hartley-normalized system) beyond homography.ts's own floor. */
  minConditionProxy: 1e-8,
} as const;

const refuse = (message: string): QuadAngleResult => ({
  ok: false,
  reason: 'POOR_GEOMETRY',
  message,
});

export function cornerAngleFromQuad(
  quad: [Px, Px, Px, Px],
  k: Intrinsics,
): QuadAngleResult {
  // --- 0. Inputs are numbers, the camera is plausible. -------------------
  for (const p of quad) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return refuse('quad has non-finite coordinates');
  }
  if (!Number.isFinite(k.fPx) || k.fPx <= 0 || !Number.isFinite(k.cx) || !Number.isFinite(k.cy)) {
    return refuse('intrinsics are invalid (fPx must be a positive pixel count)');
  }

  // --- 1. Quad shape validation. -----------------------------------------
  // Edges in traversal order P0→P1→P2→P3→P0.
  const ex = [0, 0, 0, 0];
  const ey = [0, 0, 0, 0];
  const elen = [0, 0, 0, 0];
  let maxEdge = 0;
  let minEdge = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    ex[i] = b.x - a.x;
    ey[i] = b.y - a.y;
    elen[i] = Math.hypot(ex[i]!, ey[i]!);
    maxEdge = Math.max(maxEdge, elen[i]!);
    minEdge = Math.min(minEdge, elen[i]!);
  }
  if (maxEdge < QUAD_LIMITS.minQuadPx) {
    return refuse(`quad is too small to measure (longest edge ${maxEdge.toFixed(1)} px)`);
  }
  if (minEdge < QUAD_LIMITS.minEdgeRatio * maxEdge) {
    return refuse('two marked corners nearly coincide');
  }

  // Vertex turn (cross product of incoming and outgoing edge) at each corner:
  // sign consistency ⇒ convex, consistently ordered; |sin| ⇒ collinearity.
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < 4; i++) {
    const prev = (i + 3) % 4;
    const cross = ex[prev]! * ey[i]! - ey[prev]! * ex[i]!;
    const sinAngle = Math.abs(cross) / (elen[prev]! * elen[i]!);
    if (sinAngle < QUAD_LIMITS.minVertexSin) {
      return refuse('marked corners are nearly collinear — no usable second dimension');
    }
    if (cross > 0) pos++;
    else neg++;
  }
  if (pos !== 4 && neg !== 4) {
    return refuse('quad is self-intersecting or non-convex — check the corner order');
  }

  // Shoelace area, normalized by the longest edge.
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  const normArea = Math.abs(area2 / 2) / (maxEdge * maxEdge);
  if (normArea < QUAD_LIMITS.minNormalizedArea) {
    return refuse('quad area is degenerate — the four marks are nearly a line');
  }

  // --- 2. Homography, with conditioning. ---------------------------------
  const hres = homographyUnitSquareToQuad(quad);
  if (!hres.ok) return refuse(hres.message);
  if (hres.conditionProxy < QUAD_LIMITS.minConditionProxy) {
    return refuse(
      `perspective solve is too ill-conditioned to trust (pivot ratio ${hres.conditionProxy.toExponential(1)})`,
    );
  }

  // --- 3–5. Vanishing points → signed directions → angle. ----------------
  const { v1, v2 } = vanishingPointsFromH(hres.h);
  return cornerAngleFromVanishingPoints(v1, v2, k, quad[0], quad[1], quad[3]);
}

/**
 * Shared final stage, also the entry point for the two-parallel-lines path
 * (SPEC §4.3.1.4a): given the two families' homogeneous vanishing points,
 * the corner pixel p0 and one image point along each family (used only to
 * orient signs), return the corner angle. v₁/v₂ come either from H's columns
 * or from vanishing.ts's vanishingFromParallelSegments.
 */
export function cornerAngleFromVanishingPoints(
  v1: Vec3,
  v2: Vec3,
  k: Intrinsics,
  p0: Px,
  toward1: Px,
  toward2: Px,
): QuadAngleResult {
  const s1 = resolveDirectionSign(v1, k, p0, toward1);
  if (!s1.ok) return refuse(s1.message);
  const s2 = resolveDirectionSign(v2, k, p0, toward2);
  if (!s2.ok) return refuse(s2.message);

  const d1 = vNormalize(s1.d);
  const d2 = vNormalize(s2.d);
  if (!d1 || !d2) return refuse('edge direction is degenerate (zero-length back-projection)');

  const c = Math.min(1, Math.max(-1, vDot(d1, d2)));
  const thetaDeg = (Math.acos(c) * 180) / Math.PI;
  if (!Number.isFinite(thetaDeg)) return refuse('angle computation did not converge');
  return { ok: true, thetaDeg };
}

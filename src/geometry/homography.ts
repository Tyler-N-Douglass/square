/**
 * 4-point planar homography by direct linear transform (DLT) — SPEC §4.3.1.6.
 * Owned by A3 (Geometry/Vision). Tested in tests/unit/geometry-homography.test.ts.
 *
 * Method:
 *  - Hartley normalization on both point sets (translate centroid to the
 *    origin, scale so the mean distance from it is √2) for conditioning;
 *    denormalize afterwards: H = T_dst⁻¹ · H_n · T_src.
 *  - In normalized space, fix h₃₃ = 1 and solve the 8×8 linear system with
 *    in-repo Gaussian elimination with partial pivoting (no libraries —
 *    SPEC §0/§3.1).
 *  - Degeneracy is reported, never papered over: the pivot ratio
 *    min|pivot|/max|pivot| of the normalized system is a condition proxy;
 *    near-singular systems (three collinear points, repeated points,
 *    zero-area quads) return ok:false instead of a garbage matrix.
 *
 * The returned H is scaled to unit Frobenius norm. H is homogeneous — sign
 * and scale carry no meaning, and consumers must never divide by the third
 * row unless they have checked it (see vanishing.ts for the homogeneous-safe
 * paths).
 */
import type { Mat3 } from '../types';
import { mat3Mul } from './mat';
import type { Px } from './angleSolver';

/**
 * Solve A·x = b (A row-major n×n) by Gaussian elimination with partial
 * pivoting. Returns the solution plus the smallest and largest |pivot|
 * encountered — the ratio is a cheap conditioning proxy when A's entries are
 * O(1) (which Hartley normalization guarantees for our use). Returns null on
 * an exactly-zero pivot column.
 */
export function solveLinear(
  a: Float64Array,
  n: number,
  b: Float64Array,
): { x: Float64Array; minPivot: number; maxPivot: number } | null {
  // Work on copies — callers may reuse their buffers.
  const m = Float64Array.from(a);
  const y = Float64Array.from(b);
  let minPivot = Infinity;
  let maxPivot = 0;

  for (let col = 0; col < n; col++) {
    // Partial pivot: largest |entry| in this column at or below the diagonal.
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col * n + col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r * n + col]!);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs === 0 || !Number.isFinite(pivotAbs)) return null;
    if (pivotRow !== col) {
      for (let c = col; c < n; c++) {
        const t = m[col * n + c]!;
        m[col * n + c] = m[pivotRow * n + c]!;
        m[pivotRow * n + c] = t;
      }
      const t = y[col]!;
      y[col] = y[pivotRow]!;
      y[pivotRow] = t;
    }
    minPivot = Math.min(minPivot, pivotAbs);
    maxPivot = Math.max(maxPivot, pivotAbs);
    const pivot = m[col * n + col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = m[r * n + col]! / pivot;
      if (factor === 0) continue;
      m[r * n + col] = 0;
      for (let c = col + 1; c < n; c++) m[r * n + c] = m[r * n + c]! - factor * m[col * n + c]!;
      y[r] = y[r]! - factor * y[col]!;
    }
  }

  // Back substitution.
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = y[r]!;
    for (let c = r + 1; c < n; c++) sum -= m[r * n + c]! * x[c]!;
    x[r] = sum / m[r * n + r]!;
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(x[i]!)) return null;
  return { x, minPivot, maxPivot };
}

export type HomographyResult =
  | { ok: true; h: Mat3; conditionProxy: number }
  | { ok: false; message: string };

/** Below this pivot ratio the normalized DLT system is treated as singular. */
export const H_CONDITION_MIN = 1e-10;

interface Normalization { t: Mat3; tInv: Mat3; pts: Px[] }

/** Hartley normalization: centroid → origin, mean distance → √2. */
function hartleyNormalize(points: readonly Px[]): Normalization | null {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let meanDist = 0;
  for (const p of points) meanDist += Math.hypot(p.x - mx, p.y - my);
  meanDist /= points.length;
  if (!Number.isFinite(meanDist) || meanDist <= 0) return null; // all points coincide
  const s = Math.SQRT2 / meanDist;
  const t: Mat3 = [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
  const tInv: Mat3 = [1 / s, 0, mx, 0, 1 / s, my, 0, 0, 1];
  return { t, tInv, pts: points.map((p) => ({ x: s * (p.x - mx), y: s * (p.y - my) })) };
}

/**
 * Homography mapping src[i] → dst[i] for four correspondences.
 * Use homographyUnitSquareToQuad for the CORNER quad path.
 */
export function homographyFromCorrespondences(
  src: readonly [Px, Px, Px, Px],
  dst: readonly [Px, Px, Px, Px],
): HomographyResult {
  const ns = hartleyNormalize(src);
  const nd = hartleyNormalize(dst);
  if (!ns || !nd) {
    return { ok: false, message: 'degenerate correspondence: coincident or non-finite points' };
  }

  // DLT rows with h33 = 1 in normalized space:
  //   x(h7·X + h8·Y + 1) = h1·X + h2·Y + h3
  //   y(h7·X + h8·Y + 1) = h4·X + h5·Y + h6
  const a = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const s = ns.pts[i]!;
    const d = nd.pts[i]!;
    const r0 = 2 * i * 8;
    a[r0 + 0] = s.x; a[r0 + 1] = s.y; a[r0 + 2] = 1;
    a[r0 + 6] = -d.x * s.x; a[r0 + 7] = -d.x * s.y;
    b[2 * i] = d.x;
    const r1 = (2 * i + 1) * 8;
    a[r1 + 3] = s.x; a[r1 + 4] = s.y; a[r1 + 5] = 1;
    a[r1 + 6] = -d.y * s.x; a[r1 + 7] = -d.y * s.y;
    b[2 * i + 1] = d.y;
  }

  const solved = solveLinear(a, 8, b);
  if (!solved) return { ok: false, message: 'DLT system is singular (degenerate quad)' };
  const conditionProxy = solved.minPivot / solved.maxPivot;
  if (!(conditionProxy > H_CONDITION_MIN)) {
    return {
      ok: false,
      message: `DLT system near-singular (pivot ratio ${conditionProxy.toExponential(2)})`,
    };
  }

  const hx = solved.x;
  const hn: Mat3 = [hx[0]!, hx[1]!, hx[2]!, hx[3]!, hx[4]!, hx[5]!, hx[6]!, hx[7]!, 1];
  let h = mat3Mul(nd.tInv, mat3Mul(hn, ns.t));

  // Canonical scale: unit Frobenius norm (H is homogeneous).
  let fro = 0;
  for (const e of h) fro += e * e;
  fro = Math.sqrt(fro);
  if (!Number.isFinite(fro) || fro <= 0) return { ok: false, message: 'homography is non-finite' };
  h = h.map((e) => e / fro) as unknown as Mat3;
  for (const e of h) if (!Number.isFinite(e)) return { ok: false, message: 'homography is non-finite' };

  // Rank check. A rank-deficient H (all four targets collinear) satisfies the
  // DLT correspondences exactly with healthy pivots — the pivot ratio cannot
  // see it. det of the unit-Frobenius H is the honest detector: exactly 0 for
  // a projection onto a line, and ≥ ~1e-6 for any usable pixel-scale quad
  // (measured in tests/unit/geometry-homography.test.ts).
  const det = mat3Det(h);
  if (!Number.isFinite(det) || Math.abs(det) < H_DET_MIN) {
    return { ok: false, message: 'homography is rank-deficient (marked points are collinear)' };
  }

  return { ok: true, h, conditionProxy };
}

/** Corner order matches the CORNER quad contract: (0,0)→P0, (1,0)→P1, (1,1)→P2, (0,1)→P3. */
export const UNIT_SQUARE: readonly [Px, Px, Px, Px] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * H mapping the unit square to the image quad. Its columns are then exactly
 * the two vanishing points and the image of the quad origin:
 *   H·[1,0,0]ᵀ = v₁ (edge family P0→P1 / P3→P2),
 *   H·[0,1,0]ᵀ = v₂ (edge family P0→P3 / P1→P2).
 */
export function homographyUnitSquareToQuad(quad: readonly [Px, Px, Px, Px]): HomographyResult {
  return homographyFromCorrespondences(UNIT_SQUARE, quad);
}

/**
 * Apply H to an affine point. Returns null when the image lands at (or
 * numerically indistinguishable from) infinity — callers must treat that as
 * a refusal, not a coordinate.
 */
export function applyHomography(h: Mat3, p: Px): Px | null {
  const x = h[0] * p.x + h[1] * p.y + h[2];
  const y = h[3] * p.x + h[4] * p.y + h[5];
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const scale = Math.max(Math.abs(x), Math.abs(y));
  if (!Number.isFinite(w) || Math.abs(w) <= 1e-14 * Math.max(1, scale)) return null;
  return { x: x / w, y: y / w };
}

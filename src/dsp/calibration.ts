/**
 * Magnetometer hard-iron / soft-iron calibration — SPEC §4.6.1.
 *
 * Model: the true field lies on a sphere of radius R. Hard iron adds a fixed
 * offset b; soft iron applies a (symmetric, near-identity) linear distortion
 * A. Measured samples x = A·s + b with |s| = R therefore lie on an ellipsoid
 *
 *   (x − b)ᵀ M (x − b) = c,   M = A⁻ᵀA⁻¹ (symmetric positive definite).
 *
 * Fit: least-squares quadric xᵀMx + 2vᵀx = 1 (9 parameters, normal
 * equations solved in-repo), then b = −M⁻¹v, then a symmetric Jacobi
 * eigendecomposition of M/c gives the semi-axes. The soft-iron correction
 *
 *   W = Q · diag(r̄ / rᵢ) · Qᵀ      (r̄ = geometric mean radius)
 *
 * maps the ellipsoid back to a sphere of radius r̄. Outputs match
 * CalibrationProfile.mag: hardIron b, softIron W, residual sphericity error,
 * octant coverage fraction.
 *
 * Pass criteria (SPEC §4.6): coverage of all octants, residual < 5%, and a
 * loud failure on |b| > 40 µT — that is a case magnet, not a calibration.
 */
import type { Mat3, Vec3 } from '../types';
import { eigenSym3, mulVec3, solveLinear } from './linalg';

export interface EllipsoidFit {
  ok: boolean;
  /** Why not, when !ok. Plain voice (BRAND.md). */
  reason: string | null;
  /** Hard-iron offset b, µT. */
  hardIron: Vec3;
  /** Soft-iron correction W (row-major), maps (x − b) onto a sphere. */
  softIron: Mat3;
  /** RMS sphericity error of the corrected samples, as a fraction of radius. */
  residual: number;
  /** Fraction of the 8 octants (around the fitted center) containing samples. */
  coverage: number;
  /** Mean corrected field magnitude, µT. */
  radius: number;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** |b| beyond this reads as a magnet on the phone, not a sensor bias (SPEC §4.1.6/§4.6). */
export const HARD_IRON_ACCESSORY_UT = 40;

function fail(reason: string): EllipsoidFit {
  return {
    ok: false,
    reason,
    hardIron: [0, 0, 0],
    softIron: IDENTITY,
    residual: 1,
    coverage: 0,
    radius: 0,
  };
}

function octantCoverage(points: readonly Vec3[], center: Vec3): number {
  const seen = new Set<number>();
  for (const p of points) {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];
    seen.add((dx >= 0 ? 1 : 0) | (dy >= 0 ? 2 : 0) | (dz >= 0 ? 4 : 0));
  }
  return seen.size / 8;
}

/**
 * Least-squares ellipsoid fit. Needs ≥ 12 well-spread samples; the figure-8
 * routine collects hundreds. Deterministic.
 */
export function fitEllipsoid(points: readonly Vec3[]): EllipsoidFit {
  if (points.length < 12) {
    return fail('Not enough samples. Keep rotating — the sphere needs to fill in.');
  }

  // Normal equations for D·a = 1, rows [x², y², z², 2xy, 2xz, 2yz, 2x, 2y, 2z].
  const ata: number[][] = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  const atb = new Array<number>(9).fill(0);
  const row = new Array<number>(9).fill(0);
  for (const [x, y, z] of points) {
    row[0] = x * x;
    row[1] = y * y;
    row[2] = z * z;
    row[3] = 2 * x * y;
    row[4] = 2 * x * z;
    row[5] = 2 * y * z;
    row[6] = 2 * x;
    row[7] = 2 * y;
    row[8] = 2 * z;
    for (let i = 0; i < 9; i++) {
      atb[i] = atb[i]! + row[i]!;
      for (let j = i; j < 9; j++) ata[i]![j] = ata[i]![j]! + row[i]! * row[j]!;
    }
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) ata[i]![j] = ata[j]![i]!;

  const a = solveLinear(ata, atb);
  if (!a) return fail('Samples are degenerate — sweep all directions, not one plane.');

  const M: number[][] = [
    [a[0]!, a[3]!, a[4]!],
    [a[3]!, a[1]!, a[5]!],
    [a[4]!, a[5]!, a[2]!],
  ];
  const v: Vec3 = [a[6]!, a[7]!, a[8]!];

  // Center b = −M⁻¹ v via the 3×3 solve.
  const bSol = solveLinear(M, [-v[0], -v[1], -v[2]]);
  if (!bSol) return fail('Fit is degenerate — collect a fuller figure-8 and retry.');
  const b: Vec3 = [bSol[0]!, bSol[1]!, bSol[2]!];

  // (x−b)ᵀM(x−b) = c with c = 1 + bᵀMb.
  const Mb = mulVec3(M, b);
  const c = 1 + (b[0] * Mb[0] + b[1] * Mb[1] + b[2] * Mb[2]);
  if (!(c > 0)) return fail('Fit did not close into an ellipsoid. Recalibrate away from metal.');

  const { values, vectors } = eigenSym3(M.map((r) => r.map((x) => x / c)));
  if (values.some((l) => !(l > 0))) {
    return fail('Fit is not an ellipsoid — likely too little rotation coverage.');
  }

  // Semi-axes rᵢ = 1/√λᵢ; correction W = Q diag(r̄/rᵢ) Qᵀ.
  const r = values.map((l) => 1 / Math.sqrt(l)) as [number, number, number];
  const rBar = Math.cbrt(r[0] * r[1] * r[2]);
  const w: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) {
        acc += vectors[i]![k]! * (rBar / r[k]!) * vectors[j]![k]!;
      }
      w[i]![j] = acc;
    }
  }

  // Residual sphericity: rms(|W(x−b)| − r̄) / r̄ over all samples.
  let sq = 0;
  for (const p of points) {
    const d: Vec3 = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const y = mulVec3(w, d);
    const mag = Math.hypot(y[0], y[1], y[2]);
    sq += (mag - rBar) * (mag - rBar);
  }
  const residual = Math.sqrt(sq / points.length) / rBar;
  const coverage = octantCoverage(points, b);

  const softIron: Mat3 = [
    w[0]![0]!, w[0]![1]!, w[0]![2]!,
    w[1]![0]!, w[1]![1]!, w[1]![2]!,
    w[2]![0]!, w[2]![1]!, w[2]![2]!,
  ];

  return { ok: true, reason: null, hardIron: b, softIron, residual, coverage, radius: rBar };
}

/** Apply a fit to one raw sample: W·(x − b). */
export function applyCalibration(fit: Pick<EllipsoidFit, 'hardIron' | 'softIron'>, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - fit.hardIron[0], p[1] - fit.hardIron[1], p[2] - fit.hardIron[2]];
  const s = fit.softIron;
  return [
    s[0] * d[0] + s[1] * d[1] + s[2] * d[2],
    s[3] * d[0] + s[4] * d[1] + s[5] * d[2],
    s[6] * d[0] + s[7] * d[1] + s[8] * d[2],
  ];
}
